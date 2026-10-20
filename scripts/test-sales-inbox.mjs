import assert from "node:assert/strict";
import { isCurrentSalesFinding, isOlderWatchedListing } from "../lib/salesInbox.ts";

const base = { status: "ended_pending_check", discovery_provider: null, reviewed_by: null, resulting_observation_id: null };
assert.equal(isCurrentSalesFinding({ ...base, discovery_provider: "apify_ebay_sold_search" }), true);
assert.equal(isOlderWatchedListing(base), true);
assert.equal(isCurrentSalesFinding({ ...base, status: "sold_candidate" }), true);
assert.equal(isOlderWatchedListing({ ...base, status: "sold_candidate" }), false);
assert.equal(isCurrentSalesFinding({ ...base, status: "active", discovery_provider: "apify_ebay_sold_search" }), false);
assert.equal(isCurrentSalesFinding({ ...base, reviewed_by: "SP", discovery_provider: "apify_ebay_sold_search" }), false);
assert.equal(isCurrentSalesFinding({ ...base, resulting_observation_id: "verified-sale", discovery_provider: "apify_ebay_sold_search" }), false);
console.log("Sales inbox source separation passed.");
