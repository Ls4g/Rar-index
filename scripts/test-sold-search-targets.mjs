// Which editions the daily sold-listing search picks, and when a past search
// keeps an ISBN out. No database, no network.
// Run: node --experimental-strip-types scripts/test-sold-search-targets.mjs
import assert from "node:assert/strict";
import {
  dailySearchTargets,
  FAILED_SEARCH_RETRY_DAYS,
  SCHEDULED_ISBN_REFRESH_DAYS,
  searchRefreshBlocked,
  selectScheduledSearchTargets,
} from "../lib/dailyApifySearch.ts";
import { evidenceRank, prioritiseSoldSearches } from "../lib/soldSearchPriority.ts";

const now = new Date("2026-11-11T08:00:00Z");
const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
const edition = (id, isbn, series = id) => ({ id, isbn_13: isbn, title: `${series} Vol. 1`, series, volume_number: "1", language: "English" });
const sale = (edition_id, sold_date = "2026-10-20") => ({ edition_id, sold_date, sale_price: 20, currency: "GBP",
  grading_company: null, grade_label: null, print_classification: "printing_not_identified", known_printing_number: null });
const log = (isbn_13, requested_edition_id, last_started_at, last_status, last_result_count = null) =>
  ({ isbn_13, requested_edition_id, last_started_at, last_status, last_result_count });

let n = 0;
const isbn = () => `97816126${String(30000 + (n += 1)).padStart(5, "0")}`;

// --- item 4: only a succeeded search earns the 30-day gap -------------------
assert.equal(FAILED_SEARCH_RETRY_DAYS, 2);
assert.equal(SCHEDULED_ISBN_REFRESH_DAYS, 30);
assert.equal(searchRefreshBlocked(log("x", null, daysAgo(10), "succeeded"), now), true);
assert.equal(searchRefreshBlocked(log("x", null, daysAgo(31), "succeeded"), now), false);
assert.equal(searchRefreshBlocked(log("x", null, daysAgo(1), "failed"), now), true, "a failure still waits a short gap");
assert.equal(searchRefreshBlocked(log("x", null, daysAgo(3), "failed"), now), false, "a failure does not lock out for 30 days");
assert.equal(searchRefreshBlocked(log("x", null, daysAgo(3), "running"), now), false, "a run that never recorded an end is retried");
assert.equal(searchRefreshBlocked(daysAgo(10), now), true, "a bare timestamp keeps the old succeeded meaning");
assert.equal(searchRefreshBlocked(undefined, now), false);

// The 24 rows stamped failed between 7 and 10 November become eligible again
// on their own, with no data change.
const lockedIsbn = isbn();
const locked = [edition("locked", lockedIsbn)];
assert.deepEqual(dailySearchTargets(locked, [], [], new Map([[lockedIsbn, log(lockedIsbn, "locked", "2026-11-07T06:00:00Z", "failed")]]), now)
  .map((target) => target.editionId), ["locked"]);
assert.deepEqual(dailySearchTargets(locked, [], [], new Map([[lockedIsbn, log(lockedIsbn, "locked", "2026-11-07T06:00:00Z", "succeeded", 4)]]), now),
  [], "the same timestamp on a succeeded search still blocks");

// --- item 6: closest to a price takes every slot ---------------------------
const ed = {};
const sales = [];
const add = (id, saleDates, series = id) => {
  ed[id] = edition(id, isbn(), series);
  for (const date of saleDates) sales.push(sale(id, date));
};
add("stale-a", ["2026-06-01", "2026-06-02", "2026-06-03"]); // 3 sales, newest > 90 days
add("stale-b", ["2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04"]);
add("one-short-a", ["2026-10-01", "2026-10-02"]);
add("one-short-b", ["2026-10-01", "2026-10-02"]);
add("one-short-same-series", ["2026-10-01", "2026-10-02"], "one-short-a");
add("two-short-a", ["2026-10-01"]);
add("two-short-b", ["2026-10-01"]);
add("priced", ["2026-10-01", "2026-10-02", "2026-10-03"]);
add("none-a", []);
add("none-b", []);
const editions = Object.values(ed);

const picked = selectScheduledSearchTargets(editions, sales, [], [], now, 6);
assert.deepEqual(picked.map((target) => [target.editionId, target.reason]), [
  ["stale-a", "needs_recent_sale"], ["stale-b", "needs_recent_sale"],
  ["one-short-a", "one_sale_short"], ["one-short-b", "one_sale_short"],
  ["two-short-a", "two_sales_short"], ["two-short-b", "two_sales_short"],
], "all six slots go to the closest-to-a-price tiers, in tier order, one edition per series");
assert.ok(!picked.some((target) => target.editionId === "priced"), "a priced edition is never searched");

assert.deepEqual(selectScheduledSearchTargets(editions, sales, [], [], now, 3).map((target) => target.editionId),
  ["stale-a", "stale-b", "one-short-a"], "a smaller limit is filled strictly in tier order");

// Unresolved findings and recent successful searches still exclude.
const excluded = selectScheduledSearchTargets(editions, sales,
  [{ edition_id: "stale-a", status: "ended_pending_check", discovery_provider: "apify_ebay_sold_search", reviewed_by: null, resulting_observation_id: null }],
  [log(ed["stale-b"].isbn_13, "stale-b", daysAgo(5), "succeeded", 2)], now, 6);
assert.deepEqual(excluded.map((target) => target.editionId),
  ["one-short-a", "one-short-b", "two-short-a", "two-short-b", "none-a", "none-b"]);
assert.deepEqual(excluded.slice(4).map((target) => target.reason), ["exploration", "coverage_fallback"],
  "left-over slots still go to exploration and the fallback");

// A failed ISBN is retried, but after a non-failed one in the same tier.
const failedFirst = selectScheduledSearchTargets(editions, sales, [],
  [log(ed["stale-a"].isbn_13, "stale-a", daysAgo(3), "failed")], now, 2);
assert.deepEqual(failedFirst.map((target) => target.editionId), ["stale-b", "stale-a"],
  "a failed ISBN sorts below the others in its tier but stays eligible");
assert.deepEqual(selectScheduledSearchTargets(editions, sales, [],
  [log(ed["stale-a"].isbn_13, "stale-a", daysAgo(1), "failed")], now, 2).map((target) => target.editionId),
["stale-b", "one-short-a"], "inside the retry gap a failed ISBN is skipped");

// --- item 7: add-sale suggestions use the same order -----------------------
assert.equal(evidenceRank(3, true), 0);
assert.equal(evidenceRank(2), 1);
assert.equal(evidenceRank(1), 2);
assert.equal(evidenceRank(0), 3);
assert.equal(evidenceRank(4), 4);
assert.equal(evidenceRank(3), 4);
const candidate = (profileId, comparableRawSales, needsRecentSale = undefined) => ({
  profileId, editionId: profileId, query: `q ${profileId}`, title: "Other", series: "Other", volumeNumber: 1,
  language: "English", collectibleType: "tankobon", comparableRawSales, needsRecentSale,
});
assert.deepEqual(prioritiseSoldSearches([
  candidate("four", 4), candidate("zero", 0), candidate("stale", 3, true), candidate("one", 1), candidate("two", 2), candidate("three", 3),
]).map((row) => row.profileId), ["stale", "two", "one", "zero", "four", "three"]);

console.log("Scheduled sold-search targeting checks passed.");
