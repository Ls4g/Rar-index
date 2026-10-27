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
  runSoldSearchBatch,
  soldSearchRunUrl,
  soldSearchBatchRunUrl,
  MAX_DAILY_BATCH_CHARGE_USD,
  DAILY_BATCH_RESULTS_PER_SERIES,
} from "../lib/apifySoldSearch.ts";

const url = new URL(soldSearchRunUrl());
assert.equal(url.searchParams.get("maxTotalChargeUsd"), "0.12");
assert.equal(Number(url.searchParams.get("maxItems")), RESULTS_PER_SEARCH);
assert.equal(Number(url.searchParams.get("limit")), RESULTS_PER_SEARCH);
assert.equal(url.searchParams.get("restartOnError"), "false");
assert.ok(hasSearchReserve({ usedUsd: 0, maxUsd: 1, remainingUsd: MIN_REMAINING_USD + MAX_SEARCH_CHARGE_USD }));
assert.ok(!hasSearchReserve({ usedUsd: 0, maxUsd: 1, remainingUsd: MIN_REMAINING_USD + MAX_SEARCH_CHARGE_USD - 0.01 }));
const batchUrl = new URL(soldSearchBatchRunUrl());
assert.equal(batchUrl.searchParams.get("maxTotalChargeUsd"), "0.14");
assert.equal(Number(batchUrl.searchParams.get("maxItems")), 30);
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
    assert.deepEqual(input.keywords, ["9781612620244"]);
    assert.equal(input.count, RESULTS_PER_SEARCH);
    return new Response(JSON.stringify(Array.from({ length: 40 }, (_, i) => ({ itemId: String(i) }))));
  };
  const result = await runSoldSearch("test-token", "9781612620244");
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
      assert.equal(String(requestedUrl), soldSearchBatchRunUrl());
      assert.equal(options.method, "POST");
      const input = JSON.parse(options.body);
      assert.deepEqual(input.keywords, ["9781612620244", "9781612620245"]);
      assert.equal(input.count, DAILY_BATCH_RESULTS_PER_SERIES);
      return Response.json({ data: { id: "testrun1" } });
    }
    if (batchCalls === 2) {
      assert.match(String(requestedUrl), /actor-runs\/testrun1\?waitForFinish=60$/);
      return Response.json({ data: { status: "SUCCEEDED", usageTotalUsd: 0.0081 } });
    }
    if (batchCalls === 3) {
      assert.match(String(requestedUrl), /actor-runs\/testrun1\/dataset\/items\?limit=10$/);
      return Response.json([
        { itemId: "1", keyword: "9781612620244" },
        { itemId: "2", keyword: "9781612620245" },
      ]);
    }
    assert.match(String(requestedUrl), /actor-runs\/testrun1$/);
    return Response.json({ data: { status: "SUCCEEDED", usageTotalUsd: 0.0081 } });
  };
  const result = await runSoldSearchBatch("test-token", ["9781612620244", "9781612620245"]);
  assert.equal(batchCalls, 4);
  assert.equal(result.rows.length, 2);
  assert.equal(result.costUsd, 0.0081);
  await assert.rejects(runSoldSearchBatch("test-token", ["9781612620244", "9781612620244"]), /distinct ISBNs/);
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
