import assert from "node:assert/strict";
import { checkEbayConnectionHealth } from "../lib/ebayScout.ts";
import { refreshStaleScoutAvailability, CHECK_BATCH_SIZE } from "../lib/scoutAvailability.ts";

const originalClientId = process.env.EBAY_CLIENT_ID;
const originalClientSecret = process.env.EBAY_CLIENT_SECRET;
const originalFetch = globalThis.fetch;

try {
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
  assert.equal((await checkEbayConnectionHealth()).status, "missing");

  // The count query is head:true and ends without .limit(), so the mock has to
  // be awaitable at the end of the chain as well as chainable through it.
  let eligibleCount = 241;
  const query = {
    isCount: false,
    select(_cols, options) { this.isCount = Boolean(options && options.head); return this; },
    eq() { return this; },
    lt() { return this; },
    or() { return this; },
    order() { return this; },
    then(resolve) { return resolve({ count: this.isCount ? eligibleCount : null, error: null }); },
    limit() {
      return Promise.resolve({
        data: [{ id: "lead-1", external_id: "123", listing_title: "Example", last_seen_at: "2026-01-01T00:00:00.000Z", raw_payload: null }],
        error: null,
      });
    },
  };
  const skipped = await refreshStaleScoutAvailability({ from: () => ({ ...query, isCount: false }) }, "run-1");
  // queued is the whole eligible backlog, not the slice this run took. It used
  // to be leads.length after .limit(25) had applied, so a backlog of 241
  // reported as 25 and no reader could tell the difference.
  assert.equal(skipped.queued, 241, "queued must report the eligible backlog, not the batch");
  // Pinned to the constant, not a literal, so tuning the batch cannot make
  // this test assert a stale number.
  assert.equal(skipped.batchLimit, CHECK_BATCH_SIZE, "the per-run ceiling must be reported alongside it");
  assert.ok(skipped.queued > skipped.batchLimit, "a backlog above the ceiling must remain visible as such");
  assert.equal(skipped.examined, 0);
  assert.equal(skipped.connectionStatus, "missing");
  assert.match(skipped.warning ?? "", /left untouched/i);

  // A count is reporting, so a broken count must never stop the work.
  const brokenCount = { ...query, isCount: false, then(resolve) { return resolve({ count: null, error: { message: "count failed" } }); } };
  const degraded = await refreshStaleScoutAvailability({ from: () => brokenCount }, "run-1");
  assert.equal(degraded.queued, 1, "a failed count falls back to the batch length rather than throwing");
  assert.equal(degraded.connectionStatus, "missing");

  process.env.EBAY_CLIENT_ID = "test-client";
  process.env.EBAY_CLIENT_SECRET = "test-secret";
  globalThis.fetch = async () => new Response("{}", { status: 401 });
  assert.equal((await checkEbayConnectionHealth()).status, "rejected");

  globalThis.fetch = async () => { throw new Error("network unavailable"); };
  assert.equal((await checkEbayConnectionHealth()).status, "unavailable");

  let tokenRequests = 0;
  globalThis.fetch = async () => {
    tokenRequests += 1;
    return new Response(JSON.stringify({ access_token: "test-token", expires_in: 7200 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  assert.equal((await checkEbayConnectionHealth()).status, "connected");
  assert.equal((await checkEbayConnectionHealth()).status, "connected");
  assert.equal(tokenRequests, 1, "a healthy token should be reused instead of repeatedly calling eBay");

  console.log("eBay infrastructure health and graceful degradation: 10 assertions passed.");
} finally {
  if (originalClientId === undefined) delete process.env.EBAY_CLIENT_ID;
  else process.env.EBAY_CLIENT_ID = originalClientId;
  if (originalClientSecret === undefined) delete process.env.EBAY_CLIENT_SECRET;
  else process.env.EBAY_CLIENT_SECRET = originalClientSecret;
  globalThis.fetch = originalFetch;
}

// --- RPC chunking ----------------------------------------------------------
// apply_scout_agent_availability_results refuses more than 25 leads across its
// three arrays. Raising CHECK_BATCH_SIZE to 100 hit that guard and failed every
// Market Scout run on 17 September. Results are now applied in chunks.
{
  const leads = Array.from({ length: 60 }, (_, i) => ({
    id: `lead-${i}`, external_id: String(i), listing_title: `Item ${i}`,
    last_seen_at: "2026-01-01T00:00:00.000Z", raw_payload: null,
  }));
  const calls = [];
  const db = {
    from() {
      const chain = {
        select() { return chain; },
        eq() { return chain; },
        lt() { return chain; },
        or() { return chain; },
        order() { return chain; },
        limit() { return Promise.resolve({ data: leads, error: null }); },
        then(resolve) { return resolve({ count: leads.length, error: null }); },
      };
      return chain;
    },
    rpc(_name, args) {
      const n = args.p_active.length + args.p_unavailable.length + args.p_inconclusive.length;
      calls.push(n);
      return Promise.resolve({ data: { active: args.p_active.length, unavailable: args.p_unavailable.length, inconclusive: args.p_inconclusive.length }, error: null });
    },
  };
  process.env.EBAY_CLIENT_ID = "test-client";
  process.env.EBAY_CLIENT_SECRET = "test-secret";
  globalThis.fetch = async (url) => String(url).includes("oauth")
    ? new Response(JSON.stringify({ access_token: "t", expires_in: 7200 }), { status: 200 })
    : new Response(JSON.stringify({ itemEndDate: null, buyingOptions: ["FIXED_PRICE"] }), { status: 200 });

  const many = await refreshStaleScoutAvailability(db, "run-chunk");
  assert.ok(calls.length >= 3, `60 leads must span several calls, got ${calls.length}`);
  for (const n of calls) assert.ok(n <= 25, `every RPC call must stay within the 25-lead guard, got ${n}`);
  assert.equal(calls.reduce((a, b) => a + b, 0), 60, "every lead must be applied exactly once across the chunks");
  assert.equal(many.examined, 60);
}

console.log("Availability RPC chunking passed: no call exceeds the 25-lead guard and every lead is applied once.\n");
