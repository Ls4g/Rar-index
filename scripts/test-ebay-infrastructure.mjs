import assert from "node:assert/strict";
import { checkEbayConnectionHealth } from "../lib/ebayScout.ts";
import { refreshStaleScoutAvailability } from "../lib/scoutAvailability.ts";

const originalClientId = process.env.EBAY_CLIENT_ID;
const originalClientSecret = process.env.EBAY_CLIENT_SECRET;
const originalFetch = globalThis.fetch;

try {
  delete process.env.EBAY_CLIENT_ID;
  delete process.env.EBAY_CLIENT_SECRET;
  assert.equal((await checkEbayConnectionHealth()).status, "missing");

  const query = {
    select() { return this; },
    eq() { return this; },
    lt() { return this; },
    or() { return this; },
    order() { return this; },
    limit() {
      return Promise.resolve({
        data: [{ id: "lead-1", external_id: "123", listing_title: "Example", last_seen_at: "2026-01-01T00:00:00.000Z", raw_payload: null }],
        error: null,
      });
    },
  };
  const skipped = await refreshStaleScoutAvailability({ from: () => query }, "run-1");
  assert.equal(skipped.queued, 1);
  assert.equal(skipped.examined, 0);
  assert.equal(skipped.connectionStatus, "missing");
  assert.match(skipped.warning ?? "", /left untouched/i);

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
