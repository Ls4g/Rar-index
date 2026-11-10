// No paid Apify call. Check the request ceiling and the SQL cooldown locally.
// Run: node --experimental-strip-types scripts/test-apify-search-guard.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import {
  hasSearchReserve,
  MAX_SEARCH_CHARGE_USD,
  MIN_REMAINING_USD,
  RESULTS_PER_SEARCH,
  runSoldSearch,
  runScheduledEditionSearch,
  soldSearchRunUrl,
  soldSearchEditionRunUrl,
  scheduledRunChargeCeilingUsd,
  MAX_DAILY_BATCH_CHARGE_USD,
  DAILY_BATCH_RESULTS_PER_SERIES,
  buildSoldSearchPlan,
  buildScheduledSoldSearchPlan,
  queueDiscoveredListings,
} from "../lib/apifySoldSearch.ts";

const makeEdition = (isbn, volume, series = "Attack on Titan") => ({
  id: isbn, isbn_13: isbn, title: `${series}, Vol. ${volume}`, series,
  volume_number: volume, language: "English", publisher: "Kodansha", format: "Paperback",
  printing_number: null, edition_statement: null, variant_name: null, collectible_type: "tankobon",
});
const manualPlan = buildSoldSearchPlan([makeEdition("9781612620244", 1)]);
const batchPlan = buildScheduledSoldSearchPlan([makeEdition("9781612620244", 1), makeEdition("9781612620245", 2)]);
// Changed 11 Nov 2026 (intended): the daily search is one actor run per
// edition, so the run-level checks below use a one-edition scheduled plan.
const editionPlan = buildScheduledSoldSearchPlan([makeEdition("9781612620244", 1)]);
assert.deepEqual(manualPlan.keywords, ["9781612620244", "Attack on Titan Vol 1 English manga"]);
assert.deepEqual(batchPlan.keywords, ["Attack on Titan Vol 1 English manga", "Attack on Titan Vol 2 English manga"]);
const sixSeries = Array.from({ length: 6 }, (_, index) => makeEdition(`978161262024${index}`, 1, `Series ${index}`));
assert.equal(buildScheduledSoldSearchPlan(sixSeries).keywords.length, 6);
assert.deepEqual(buildSoldSearchPlan([{ ...makeEdition("9784063144239", 1, "Blame!"), language: "Japanese" }]).keywords,
  ["9784063144239", "Blame! Vol 1 Japanese manga"]);
assert.equal(buildSoldSearchPlan([makeEdition("9781612620244", 1), makeEdition("9781612620245", 1)]).keywords.length, 2);

const queuedRows = [];
const fakeAdmin = { from(table) {
  assert.equal(table, "listing_outcomes");
  return { upsert(rows, options) {
    assert.equal(options.ignoreDuplicates, true);
    queuedRows.push(...rows);
    return { select: async () => ({ data: rows.map((_, index) => ({ id: String(index) })), error: null }) };
  } };
} };
await queueDiscoveredListings(fakeAdmin, [{
  itemId: "298739416531", title: "Attack on Titan manga Vol 9 set",
  url: "https://www.ebay.com/itm/298739416531", keyword: manualPlan.keywords[1],
  soldPrice: "147.00", soldCurrency: "USD", endedAt: "2026-10-17",
}], [makeEdition("9781612620244", 1)], [], "source", manualPlan);
assert.equal(queuedRows.length, 1);
assert.equal(queuedRows[0].status, "ended_pending_check");
assert.equal(queuedRows[0].match_assessment.confidence, "conflict");
assert.ok(!Object.hasOwn(queuedRows[0], "sold_price"));

const url = new URL(soldSearchRunUrl());
assert.equal(url.searchParams.get("maxTotalChargeUsd"), "0.12");
assert.equal(Number(url.searchParams.get("maxItems")), RESULTS_PER_SEARCH);
assert.equal(Number(url.searchParams.get("limit")), RESULTS_PER_SEARCH);
assert.equal(url.searchParams.get("restartOnError"), "false");
assert.ok(hasSearchReserve({ usedUsd: 0, maxUsd: 1, remainingUsd: MIN_REMAINING_USD + MAX_SEARCH_CHARGE_USD }));
assert.ok(!hasSearchReserve({ usedUsd: 0, maxUsd: 1, remainingUsd: MIN_REMAINING_USD + MAX_SEARCH_CHARGE_USD - 0.01 }));
const batchUrl = new URL(soldSearchEditionRunUrl(scheduledRunChargeCeilingUsd(6)));
assert.ok(Number(batchUrl.searchParams.get("maxTotalChargeUsd")) * 6 <= MAX_DAILY_BATCH_CHARGE_USD, "six runs stay inside the daily ceiling");
assert.equal(Number(batchUrl.searchParams.get("maxItems")), DAILY_BATCH_RESULTS_PER_SERIES, "same results per keyword");
assert.ok(MAX_DAILY_BATCH_CHARGE_USD < 0.15);
assert.ok(!hasSearchReserve({ usedUsd: 0, maxUsd: 1, remainingUsd: MIN_REMAINING_USD + MAX_DAILY_BATCH_CHARGE_USD - 0.01 }, MAX_DAILY_BATCH_CHARGE_USD));

const originalFetch = globalThis.fetch;
let calls = 0;
try {
  globalThis.fetch = async (requestedUrl, options) => {
    calls += 1;
    assert.equal(String(requestedUrl), soldSearchRunUrl());
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    const input = JSON.parse(options.body);
    assert.deepEqual(input.keywords, manualPlan.keywords);
    assert.equal(input.count, 12);
    return new Response(JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ itemId: String(i), keyword: manualPlan.keywords[i % 2] }))));
  };
  const result = await runSoldSearch("test-token", manualPlan);
  assert.equal(calls, 1);
  assert.equal(result.rows.length, RESULTS_PER_SEARCH);
} finally {
  globalThis.fetch = originalFetch;
}

let batchCalls = 0;
try {
  globalThis.fetch = async (requestedUrl, options) => {
    batchCalls += 1;
    if (batchCalls === 1) {
      assert.equal(String(requestedUrl), soldSearchEditionRunUrl(0.0233));
      assert.equal(options.method, "POST");
      const input = JSON.parse(options.body);
      assert.deepEqual(input.keywords, editionPlan.keywords);
      assert.equal(input.count, 4);
      return Response.json({ data: { id: "testrun1" } });
    }
    if (batchCalls === 2) {
      assert.match(String(requestedUrl), /actor-runs\/testrun1\?waitForFinish=60$/);
      return Response.json({ data: { status: "SUCCEEDED", usageTotalUsd: 0.0081 } });
    }
    if (batchCalls === 3) {
      assert.match(String(requestedUrl), /actor-runs\/testrun1\/dataset\/items\?limit=4$/);
      return Response.json([
        { itemId: "1", keyword: "Attack on Titan Vol 2 English manga" },
        { itemId: "2", keyword: "Attack on Titan Vol 1 English manga" },
      ]);
    }
    assert.match(String(requestedUrl), /actor-runs\/testrun1$/);
    return Response.json({ data: { status: "SUCCEEDED", usageTotalUsd: 0.0081 } });
  };
  const result = await runScheduledEditionSearch("test-token", editionPlan, { maxChargeUsd: 0.0233, deadlineAt: Date.now() + 120_000 });
  assert.equal(batchCalls, 4);
  // Changed 11 Nov 2026 (intended): a row for a keyword this run did not ask
  // for is dropped on its own instead of failing the whole run.
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.dropCounts, { unexpected_keyword: 1 });
  assert.equal(result.costUsd, 0.0081);
  assert.throws(() => buildSoldSearchPlan([makeEdition("9781612620244", 1), makeEdition("9781612620244", 1)]), /distinct valid ISBNs/);
} finally {
  globalThis.fetch = originalFetch;
}

const db = new PGlite();
try {
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec("create table public.manga_editions (id uuid primary key);");
  const firstEdition = "11111111-1111-1111-1111-111111111111";
  const siblingEdition = "22222222-2222-2222-2222-222222222222";
  await db.query("insert into public.manga_editions(id) values ($1::uuid), ($2::uuid)", [firstEdition, siblingEdition]);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261019_price_coverage_search_cooldown.sql", import.meta.url), "utf8"));

  async function claim(editionId) {
    const { rows } = await db.query(
      "select public.claim_price_coverage_search($1::text, $2::uuid, 12) as claimed",
      ["9781612620244", editionId],
    );
    return rows[0].claimed;
  }

  assert.equal(await claim(firstEdition), true);
  assert.equal(await claim(firstEdition), false, "an empty run still consumes its cooldown");
  assert.equal(await claim(siblingEdition), false, "siblings sharing an ISBN cannot start a second run");
  await db.query("update public.price_coverage_search_cooldowns set last_started_at = now() - interval '13 hours'");
  assert.equal(await claim(siblingEdition), true, "the ISBN becomes claimable after cooldown");
  const { rows } = await db.query("select requested_edition_id, last_status from public.price_coverage_search_cooldowns");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requested_edition_id, siblingEdition);
  assert.equal(rows[0].last_status, "running");
} finally {
  await db.close();
}

console.log("Apify cost cap and ISBN cooldown checks passed.");
