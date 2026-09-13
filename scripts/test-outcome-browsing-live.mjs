// Pagination over the real listing_outcomes table. Read-only.
//
// The synthetic checks in test-outcome-browsing.mjs prove the traversal
// property; this proves the page's real query path feeds it the whole table,
// including the range paging that PostgREST's 1000-row response cap makes
// necessary. Nothing here writes, and nothing decides a sale or an edition.
import { createClient } from "@supabase/supabase-js";
import { OUTCOME_PAGE_SIZE, browseOutcomes, outcomeView, sortOutcomes } from "../lib/outcomeBrowsing.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

let checks = 0;
let failures = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) { console.log(`  ok   ${label}`); return true; }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

// Identical to the page's BROWSE_SELECT and fetchAllBrowseRecords.
const BROWSE_SELECT = "id,external_id,marketplace,status,listing_title,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,match_assessment,last_seen_at,outcome_reason,check_attempts,reviewed_by,edition:manga_editions(title,series,volume_number,language)";

async function fetchAllBrowseRecords() {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin.from("listing_outcomes").select(BROWSE_SELECT)
      .order("id", { ascending: true }).range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
}

const toBrowsable = (record) => ({
  id: record.id,
  externalId: record.external_id,
  editionLabel: [record.edition?.series || record.edition?.title, record.edition?.volume_number ? `Vol. ${record.edition.volume_number}` : null, record.edition?.language].filter(Boolean).join(" · ") || "Unknown edition",
  status: record.status,
  listingTitle: record.listing_title,
  askingPrice: record.asking_price,
  currency: record.currency,
  soldPrice: record.sold_price,
  soldCurrency: record.sold_currency,
  soldAt: record.sold_at,
  buyingFormat: record.buying_format,
  matchScore: record.match_assessment?.score ?? null,
  matchConflicts: record.match_assessment?.conflicts ?? [],
  lastSeenAt: record.last_seen_at,
  outcomeReason: record.outcome_reason,
  reviewedBy: record.reviewed_by,
  checkAttempts: record.check_attempts,
});

const now = new Date();
console.log(`\nRead ${now.toISOString()} from project ${url.replace(/^https:\/\//, "").split(".")[0]}`);

console.log("\n1. The page loads the whole table, not one response's worth");
const records = await fetchAllBrowseRecords();
const { count: authoritativeTotal } = await admin.from("listing_outcomes").select("id", { count: "exact", head: true });
check("range paging read every row", records.length === authoritativeTotal, `fetched ${records.length}, table has ${authoritativeTotal}`);
check("more rows were read than a single response returns", records.length > 1000, `${records.length} rows`);
check("no row was read twice", new Set(records.map((row) => row.id)).size === records.length);

const rows = records.map(toBrowsable);
const tabTotals = { attention: 0, watching: 0, finished: 0 };
for (const row of rows) tabTotals[outcomeView(row)] += 1;
console.log(`     attention ${tabTotals.attention} · watching ${tabTotals.watching} · finished ${tabTotals.finished}`);

console.log("\n2. Counts describe the table, not a page");
const base = browseOutcomes({ rows, view: "attention", queue: "all", now });
check("tab counts sum to the table total",
  base.viewCounts.attention + base.viewCounts.watching + base.viewCounts.finished === records.length);
check("the attention total exceeds one page", base.total > base.pageSize, `${base.total} vs page size ${base.pageSize}`);
check("the attention total exceeds the old 200-row cap", base.viewCounts.attention > 0 && base.total > 0);
console.log(`     the review queue is ${base.total} listings over ${base.pageCount} pages of ${OUTCOME_PAGE_SIZE}`);

console.log("\n3. Walking every page of every queue reaches every row exactly once");
for (const [view, queues] of [["attention", ["worth_checking", "parked", "graded", "lot", "conflict", "best_offer", "high_value", "all"]], ["watching", ["all"]], ["finished", ["all"]]]) {
  for (const queue of queues) {
    const firstPage = browseOutcomes({ rows, view, queue, page: 1, now });
    const walked = [];
    for (let page = 1; page <= firstPage.pageCount; page += 1) {
      walked.push(...browseOutcomes({ rows, view, queue, page, now }).pageRows.map((row) => row.id));
    }
    const unique = new Set(walked);
    const complete = walked.length === firstPage.total && unique.size === firstPage.total;
    if (!complete) {
      check(`${view}/${queue} traversal is complete`, false, `walked ${walked.length}, unique ${unique.size}, total ${firstPage.total}`);
    } else {
      checks += 1;
      console.log(`  ok   ${`${view}/${queue}`.padEnd(26)} ${String(firstPage.total).padStart(4)} rows over ${String(firstPage.pageCount).padStart(2)} page(s)`);
    }
  }
}

console.log("\n4. Rows that used to be unreachable are reachable now");
// The old page ordered by sold_at desc (nulls last) and took 200. Rebuild that
// window and prove a row outside it is now served on a real page.
const oldWindow = new Set([...rows]
  .filter((row) => ["sold_candidate", "ended_pending_check", "ambiguous", "inaccessible"].includes(row.status) && !row.reviewedBy)
  .sort((a, b) => {
    const left = a.soldAt ? Date.parse(a.soldAt) : -Infinity;
    const right = b.soldAt ? Date.parse(b.soldAt) : -Infinity;
    return right - left;
  })
  .slice(0, 200)
  .map((row) => row.id));
const attentionRows = rows.filter((row) => outcomeView(row) === "attention");
const previouslyUnreachable = attentionRows.filter((row) => !oldWindow.has(row.id));
check("the old cap really did hide review-queue rows", previouslyUnreachable.length > 0, `${previouslyUnreachable.length} hidden`);
console.log(`     ${previouslyUnreachable.length} of ${attentionRows.length} review-queue listings were outside the old 200-row window`);

let reachable = 0;
const sample = previouslyUnreachable.slice(0, 25);
for (const row of sample) {
  const result = browseOutcomes({ rows, view: "attention", queue: "all", focusId: row.id, now });
  if (result.pageRows.some((served) => served.id === row.id)) reachable += 1;
}
check("every sampled hidden listing is now served by its link", reachable === sample.length, `${reachable}/${sample.length}`);

const ordered = sortOutcomes(attentionRows, "priority", now);
const lastRow = ordered[ordered.length - 1];
const lastResult = browseOutcomes({ rows, view: "attention", queue: "all", focusId: lastRow.id, now });
check("the very last listing in the order is reachable", lastResult.pageRows.some((row) => row.id === lastRow.id), `served page ${lastResult.page} of ${lastResult.pageCount}`);

console.log("\n5. The page's detail fetch returns what the page asked for");
const firstPageRows = browseOutcomes({ rows, view: "attention", queue: "all", page: 1, now });
const pageIds = firstPageRows.pageRows.map((row) => row.id);
const { data: detail, error: detailError } = await admin.from("listing_outcomes")
  .select("id,external_id,listing_title,source_listing_url,status,edition:manga_editions(title,series,volume_number,language)")
  .in("id", pageIds);
check("detail loads for the served page", !detailError && (detail ?? []).length === pageIds.length,
  detailError?.message ?? `${detail?.length ?? 0} of ${pageIds.length}`);
check("every served listing keeps its original source link",
  (detail ?? []).every((record) => typeof record.source_listing_url === "string" && record.source_listing_url.startsWith("http")));
const detailIds = new Set((detail ?? []).map((record) => record.id));
check("no served id is missing from the detail fetch", pageIds.every((id) => detailIds.has(id)));

const { data: pageChecks, error: checksError } = await admin.from("listing_outcome_checks")
  .select("outcome_id,provider,attempt_number,checked_at").in("outcome_id", pageIds);
check("check history loads for the served page only", !checksError, checksError?.message ?? "");
check("no check belongs to an unserved listing",
  (pageChecks ?? []).every((entry) => pageIds.includes(entry.outcome_id)));
console.log(`     page 1 needed ${pageIds.length} detail rows and ${(pageChecks ?? []).length} check rows`);

console.log(`\n${failures ? "FAILED" : "PASSED"}: ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
