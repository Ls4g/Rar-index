import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { configuredDailySearchLimit, dailySearchTargets, distinctSeriesTargets, selectScheduledSearchTargets } from "../lib/dailyApifySearch.ts";

assert.equal(configuredDailySearchLimit(undefined), 0);
assert.equal(configuredDailySearchLimit("0"), 0);
assert.equal(configuredDailySearchLimit("11"), 0);
assert.equal(configuredDailySearchLimit("3"), 3);

const edition = (id, isbn) => ({ id, isbn_13: isbn, title: "Vol. 1", series: id, volume_number: "1", language: "English" });
const sale = (edition_id) => ({ edition_id, sold_date: "2026-10-01", sale_price: 20, currency: "GBP",
  grading_company: null, grade_label: null, print_classification: "printing_not_identified", known_printing_number: null });
const outcome = (edition_id, extra = {}) => ({ edition_id, status: "ended_pending_check", discovery_provider: "apify_ebay_sold_search",
  reviewed_by: null, resulting_observation_id: null, ...extra });
const search = (isbn_13, requested_edition_id, last_started_at, last_result_count = 0) => ({
  isbn_13, requested_edition_id, last_started_at, last_result_count, last_status: "succeeded",
});
const editions = [
  edition("near", "9781612620244"), edition("sibling", "9781612620244"),
  edition("waiting", "9781612620245"), edition("blank", null), edition("none", "9781612620246"),
];
assert.deepEqual(dailySearchTargets(editions, [sale("near"), sale("near")], [outcome("waiting")]), [
  { editionId: "near", isbn: "9781612620244" }, { editionId: "none", isbn: "9781612620246" },
]);
assert.deepEqual(dailySearchTargets(editions, [sale("near"), sale("near")], [
  outcome("sibling"), outcome("waiting"),
]), [{ editionId: "none", isbn: "9781612620246" }], "a sibling's pending finding blocks a duplicate ISBN search");
assert.deepEqual(dailySearchTargets([edition("near", "9781612620244")], [], [
  outcome("near", { status: "ambiguous", check_attempts: 5, next_check_at: null }),
]), [{ editionId: "near", isbn: "9781612620244" }], "exhausted unknowns do not suppress new discovery");
assert.deepEqual(dailySearchTargets([edition("near", "9781612620244")], [], [],
  new Map([["9781612620244", "2026-10-01T00:00:00Z"]]), new Date("2026-10-26T00:00:00Z")),
  [], "a recently paid search is not repeated every morning");

const sixSeries = Array.from({ length: 7 }, (_, i) => ({ ...edition(`edition-${i}`, `9781612620${String(240 + i)}`),
  series: i === 1 ? " SERIES-0 " : `Series-${i}` }));
assert.deepEqual(distinctSeriesTargets(sixSeries.map((item) => ({ editionId: item.id, isbn: item.isbn_13 })), sixSeries)
  .map((item) => item.editionId), ["edition-0", "edition-2", "edition-3", "edition-4", "edition-5", "edition-6"],
"one batch selects six different series even when one title has another volume");

const selectionNow = new Date("2026-10-31T08:00:00Z");
const selectionEditions = [
  ...["near-a", "near-b", "near-c", "near-d"].map((id, i) => edition(id, `9781612621${String(100 + i)}`)),
  { ...edition("near-a-copy", "9781612621104"), series: "NEAR-A" },
  ...["proven-a", "proven-b"].flatMap((series, i) => [
    { ...edition(`${series}-source`, `9781612621${String(105 + i * 2)}`), series },
    { ...edition(`${series}-target`, `9781612621${String(106 + i * 2)}`), series },
  ]),
  { ...edition("explore-spanish", "9781612621109"), language: "Spanish", volume_number: "2" },
  edition("explore-english", "9781612621110"),
];
const selectionSales = [
  ...["near-a", "near-b", "near-c", "near-d"].flatMap((id) => [sale(id), sale(id)]),
  sale("proven-a-source"), sale("proven-b-source"),
];
assert.deepEqual(selectScheduledSearchTargets(selectionEditions, selectionSales, [], [], selectionNow), [
  { editionId: "near-a", isbn: "9781612621100", reason: "near_chart" },
  { editionId: "near-b", isbn: "9781612621101", reason: "near_chart" },
  { editionId: "near-c", isbn: "9781612621102", reason: "near_chart" },
  { editionId: "proven-a-target", isbn: "9781612621106", reason: "proven_series" },
  { editionId: "proven-b-target", isbn: "9781612621108", reason: "proven_series" },
  { editionId: "explore-english", isbn: "9781612621110", reason: "exploration" },
], "six slots mix near-chart, verified-series and exploratory editions without repeating a series");
assert.deepEqual(selectScheduledSearchTargets(selectionEditions, selectionSales,
  [outcome("near-a")], [search("9781612621101", "near-b", "2026-10-15T08:00:00Z")], selectionNow, 3)
  .map((target) => target.editionId), ["near-c", "near-d", "explore-english"],
"pending human review and recently paid ISBN searches remain excluded, and a smaller configured limit is obeyed");
assert.deepEqual(selectScheduledSearchTargets(selectionEditions.slice(0, 2), [], [], [], selectionNow)
  .map((target) => target.reason), ["exploration", "coverage_fallback"],
"unused slots are filled rather than silently reducing the daily batch");
const recentEmptyEditions = [
  { ...edition("empty-source", "9781612621111"), series: "Empty" },
  { ...edition("empty-next", "9781612621112"), series: "Empty" },
  edition("untested", "9781612621113"),
];
assert.equal(selectScheduledSearchTargets(recentEmptyEditions, [], [],
  [search("9781612621111", "empty-source", "2026-10-30T08:00:00Z")], selectionNow, 1)[0].editionId,
"untested", "a zero-result search soft-demotes another edition in that series for a week");
assert.equal(selectScheduledSearchTargets(recentEmptyEditions.slice(0, 2), [], [],
  [search("9781612621111", "empty-source", "2026-10-30T08:00:00Z")], selectionNow, 1)[0].editionId,
"empty-next", "a zero-result series is still eligible when no better series remains");

const db = new PGlite();
try {
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec("create table public.manga_editions (id uuid primary key);");
  const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
  await db.query("insert into public.manga_editions(id) values ($1::uuid), ($2::uuid)", ids);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261019_price_coverage_search_cooldown.sql", import.meta.url), "utf8"));
  await db.exec(readFileSync(new URL("../supabase/migrations/20261026_scheduled_apify_daily_limit.sql", import.meta.url), "utf8"));

  const claim = async (isbn, id, dailyLimit = 2) => (await db.query(
    "select public.claim_scheduled_apify_search($1::text, $2::uuid, $3::integer, 12) as result",
    [isbn, id, dailyLimit],
  )).rows[0].result;
  assert.equal(await claim("9781612620244", ids[0]), "claimed");
  assert.equal(await claim("9781612620244", ids[1]), "cooldown", "same ISBN cannot be charged twice");
  assert.equal(await claim("9781612620245", ids[1]), "claimed");
  assert.equal(await claim("9781612620246", ids[1]), "daily_limit", "daily limit stops a third run");
  const { rows } = await db.query("select claimed_searches from public.apify_daily_search_usage");
  assert.equal(rows[0].claimed_searches, 2, "cooldown denial did not burn a slot");
} finally {
  await db.close();
}

console.log("Daily Apify target ranking and atomic cost guard passed.");
