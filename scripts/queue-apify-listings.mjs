// Queue Apify-discovered eBay listings for RAR's own eBay outcome check.
//
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/queue-apify-listings.mjs <apify-dataset-id | path/to/rows.json> [--commit]
//
// Without --commit this writes nothing and prints exactly what it would do.
//
// What it writes, and what it refuses to write.
//
// Each surviving row becomes one listing_outcomes row at status
// `ended_pending_check`, which is the queue RAR's deployed pipeline already
// drains on the /api/cron/listing-outcomes schedule. That pipeline calls
// eBay's Trading GetItem and reads quantitySold on the item itself, which is
// what decides whether the listing sold. A sale then still needs a person to
// confirm it in the review screen before it becomes evidence.
//
// sold_price, sold_currency and sold_at are never written here. The schema
// reserves them for an explicit completed-sale signal, and Apify is not one:
// its sold flag only echoes the search filter that produced the row. Writing
// Apify's number into those columns would manufacture evidence, which is the
// one thing AGENTS.md forbids outright.
//
// Re-running is safe. The insert is an upsert on (marketplace, external_id)
// with ignoreDuplicates, the same guard captureWatchedListings uses, so a
// listing already being watched -- and in particular one a person has already
// decided about -- is never rewritten.
//
// Every decision comes from lib/apifyListingIntake.ts, shared with
// scripts/report-apify-match.mjs so the preview cannot disagree with the write.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadActiveScoutRules } from "../lib/scoutRules.ts";
import { buildOutcomeRow, classifyApifyRow, indexEditionsByIsbn } from "../lib/apifyListingIntake.ts";

const EDITION_COLUMNS =
  "id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no";

// The eBay Sold source row. Every listing_outcomes row RAR already holds uses
// it, so a discovered listing belongs to the same source rather than a new one.
const EBAY_SOLD_SOURCE_NAME = "eBay Sold";

// A single batch should not be able to flood the queue. 25 rows per Apify
// search is the shape of the runs this was built against; a few searches at
// once is fine, a thousand rows from an unattended loop is not.
const MAX_QUEUE_PER_RUN = 200;

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const source = args.find((value) => !value.startsWith("--"));
if (!source) {
  console.error("Usage: queue-apify-listings.mjs <apify-dataset-id | path/to/rows.json> [--commit]");
  process.exit(1);
}

async function loadRows(ref) {
  if (ref.endsWith(".json")) return JSON.parse(readFileSync(ref, "utf8"));
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set; add it to .env.local");
  const res = await fetch(`https://api.apify.com/v2/datasets/${ref}/items?clean=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Apify dataset read failed: HTTP ${res.status}`);
  return res.json();
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const [rows, rules, editionResult, sourceResult] = await Promise.all([
  loadRows(source),
  loadActiveScoutRules(admin),
  admin.from("manga_editions").select(EDITION_COLUMNS),
  admin.from("sources").select("id,name").eq("name", EBAY_SOLD_SOURCE_NAME).maybeSingle(),
]);
if (editionResult.error) throw new Error(`Could not read the catalogue: ${editionResult.error.message}`);
if (sourceResult.error) throw new Error(`Could not read sources: ${sourceResult.error.message}`);
if (!sourceResult.data?.id) throw new Error(`No "${EBAY_SOLD_SOURCE_NAME}" source row exists. Nothing was written.`);
const sourceId = sourceResult.data.id;

const byIsbn = indexEditionsByIsbn(editionResult.data ?? []);

const queued = [];
const counts = { queue: 0, human: 0, drop: 0 };
for (const row of rows) {
  const decision = classifyApifyRow(row, byIsbn, rules);
  counts[decision.kind] += 1;
  if (decision.kind === "queue") queued.push({ row, decision });
}

console.log(`${commit ? "COMMIT" : "DRY RUN"}   rows: ${rows.length}   source: ${EBAY_SOLD_SOURCE_NAME} ${sourceId}`);
console.log(`classified: ${counts.queue} to queue, ${counts.human} need a person, ${counts.drop} dropped`);

if (queued.length > MAX_QUEUE_PER_RUN) {
  console.error(`\nRefusing: ${queued.length} rows exceeds the ${MAX_QUEUE_PER_RUN}-row ceiling for one run. Nothing was written.`);
  process.exit(1);
}
if (!queued.length) {
  console.log("\nNothing to queue.");
  process.exit(0);
}

// Which of these is already known, so the dry run reports the same numbers the
// commit will. Read in one query rather than one per row.
const externalIds = queued.map(({ row }) => String(row.itemId));
const { data: existingRows, error: existingError } = await admin
  .from("listing_outcomes")
  .select("external_id,marketplace,status,reviewed_by")
  .in("external_id", externalIds);
if (existingError) throw new Error(`Could not check for existing rows: ${existingError.message}`);
const existing = new Map((existingRows ?? []).map((item) => [`${item.marketplace}|${item.external_id}`, item]));

const toInsert = [];
let alreadyKnown = 0;
for (const { row, decision } of queued) {
  const outcomeRow = buildOutcomeRow(row, decision.pick, sourceId);
  const key = `${outcomeRow.marketplace}|${outcomeRow.external_id}`;
  const seen = existing.get(key);
  if (seen) {
    alreadyKnown += 1;
    console.log(`  already in RAR  ${outcomeRow.external_id}  status=${seen.status}${seen.reviewed_by ? ` reviewed by ${seen.reviewed_by}` : ""}`);
    continue;
  }
  toInsert.push(outcomeRow);
}

console.log(`\nnew: ${toInsert.length}   already in RAR (left untouched): ${alreadyKnown}`);
for (const outcomeRow of toInsert) {
  console.log(`  ${outcomeRow.external_id}  ${String(outcomeRow.listing_title).slice(0, 56)}`);
  console.log(`     edition=${outcomeRow.edition_id}  ${outcomeRow.marketplace}  ends=${outcomeRow.scheduled_end_at ?? "-"}  asking=${outcomeRow.asking_price ?? "-"} ${outcomeRow.currency ?? ""}`);
}

if (!commit) {
  console.log("\nDRY RUN -- nothing written. Re-run with --commit to queue these.");
  process.exit(0);
}
if (!toInsert.length) {
  console.log("\nNothing new to write.");
  process.exit(0);
}

// ignoreDuplicates keeps any existing row, and any human decision on it,
// completely intact -- the same guard captureWatchedListings uses.
const { data: inserted, error: insertError } = await admin
  .from("listing_outcomes")
  .upsert(toInsert, { onConflict: "marketplace,external_id", ignoreDuplicates: true })
  .select("id,external_id");
if (insertError) throw new Error(`Insert failed, nothing was queued: ${insertError.message}`);

console.log(`\nqueued ${inserted?.length ?? 0} listing(s) at status ended_pending_check.`);
console.log("RAR's listing-outcomes cron will ask eBay about each one. A sale");
console.log("still needs your confirmation in the review screen before it counts.");
