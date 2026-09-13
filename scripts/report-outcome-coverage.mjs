// How many listing outcomes exist, how many a human can actually reach, and
// which tab each one lands in. Read-only.
//
// The page's own SQL filter is not the same set as the "attention" tab: viewFor
// sends an ended_pending_check row that has never been checked to "watching",
// because RAR has nothing to tell a human about a listing it has not looked at.
// Any count that ignores that overstates the review queue, so this script
// reports the SQL-qualifying set and the classified tabs separately, with the
// filters and denominators written out.
import { createClient } from "@supabase/supabase-js";
import { classifyListingOutcome } from "../lib/listingOutcomeTriage.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const ATTENTION_STATUSES = ["sold_candidate", "ended_pending_check", "ambiguous", "inaccessible"];
const FINISHED_STATUSES = ["unsold", "review_complete"];

// PostgREST caps a single response (Supabase defaults to 1000 rows), so a
// count that matters has to be read in ranges until a short page comes back.
// Reading 200 rows and reporting the total as 200 is exactly the bug this
// script exists to measure.
async function fetchAll(build, pageSize = 1000) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

const SELECT = "id,status,reviewed_by,listing_title,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,match_assessment,last_seen_at,outcome_reason,check_attempts";

const now = new Date();
console.log(`\nListing-outcome coverage — read ${now.toISOString()}`);
console.log(`Project: ${url.replace(/^https:\/\//, "").split(".")[0]}`);

const { count: totalRows } = await admin.from("listing_outcomes").select("id", { count: "exact", head: true });
console.log(`\nDenominator: ${totalRows} listing_outcomes rows in total.\n`);

console.log("By status (no other filter):");
const statusTotals = {};
for (const status of [...ATTENTION_STATUSES, "active", ...FINISHED_STATUSES]) {
  const { count } = await admin.from("listing_outcomes").select("id", { count: "exact", head: true }).eq("status", status);
  statusTotals[status] = count ?? 0;
  console.log(`  ${status.padEnd(22)} ${count}`);
}

// Exactly the page's attention filter: the four statuses, not yet reviewed.
const attentionRows = await fetchAll(() => admin.from("listing_outcomes").select(SELECT)
  .in("status", ATTENTION_STATUSES).is("reviewed_by", null));
console.log(`\nSQL-qualifying attention filter (status in [${ATTENTION_STATUSES.join(", ")}] AND reviewed_by IS NULL): ${attentionRows.length}`);

const toTriageable = (row) => ({
  status: row.status,
  listingTitle: row.listing_title,
  askingPrice: row.asking_price,
  currency: row.currency,
  soldPrice: row.sold_price,
  soldCurrency: row.sold_currency,
  soldAt: row.sold_at,
  buyingFormat: row.buying_format,
  matchScore: row.match_assessment?.score ?? null,
  matchConflicts: row.match_assessment?.conflicts ?? [],
  lastSeenAt: row.last_seen_at,
  outcomeReason: row.outcome_reason,
});

// viewFor, reproduced from the panel.
const neverChecked = attentionRows.filter((row) => row.status === "ended_pending_check" && row.check_attempts === 0);
const realAttention = attentionRows.filter((row) => !(row.status === "ended_pending_check" && row.check_attempts === 0));
console.log(`  → land in the "attention" tab (a human has a question to answer): ${realAttention.length}`);
console.log(`  → reclassified to "watching" (ended_pending_check, never checked): ${neverChecked.length}`);

console.log(`\nAttention tab (denominator ${realAttention.length}) by queue:`);
const queues = ["worth_checking", "best_offer", "high_value", "conflict", "graded", "lot", "parked", "all"];
const triaged = realAttention.map((row) => ({ row, triage: classifyListingOutcome(toTriageable(row), now) }));
const inQueue = {
  worth_checking: (t) => t.worthChecking,
  best_offer: (t) => t.isBestOffer,
  high_value: (t) => t.isHighValue,
  conflict: (t) => t.hasEditionConflict,
  graded: (t) => t.isGraded,
  lot: (t) => t.isLot,
  parked: (t) => !t.worthChecking,
  all: () => true,
};
for (const queue of queues) {
  const matching = triaged.filter(({ triage }) => inQueue[queue](triage)).length;
  const share = realAttention.length ? ((matching / realAttention.length) * 100).toFixed(1) : "0.0";
  console.log(`  ${queue.padEnd(16)} ${String(matching).padStart(4)}  (${share}% of the attention tab)`);
}

const activeRows = await fetchAll(() => admin.from("listing_outcomes").select("id,status").eq("status", "active"));
const finishedUnreviewed = await fetchAll(() => admin.from("listing_outcomes").select("id,status").in("status", FINISHED_STATUSES));
const { count: reviewedAny } = await admin.from("listing_outcomes").select("id", { count: "exact", head: true }).not("reviewed_by", "is", null);
console.log(`\nWatching tab: ${activeRows.length} active + ${neverChecked.length} never-checked = ${activeRows.length + neverChecked.length}`);
console.log(`Finished tab: ${finishedUnreviewed.length} unsold/review_complete, plus any reviewed row in another status (${reviewedAny} rows carry a reviewer)`);

console.log("\nWhat the page could actually render before pagination:");
console.log(`  attention query capped at 200 → ${Math.min(200, attentionRows.length)} of ${attentionRows.length} fetched (${attentionRows.length - Math.min(200, attentionRows.length)} unreachable)`);
console.log(`  active query capped at  75 → ${Math.min(75, activeRows.length)} of ${activeRows.length} fetched (${Math.max(0, activeRows.length - 75)} unreachable)`);
console.log(`  finished query capped at 25 → ${Math.min(25, finishedUnreviewed.length)} of ${finishedUnreviewed.length} fetched (${Math.max(0, finishedUnreviewed.length - 25)} unreachable)`);
console.log("\nThe tab and queue counts the panel displayed were computed over that capped sample, so they understated every queue.\n");
