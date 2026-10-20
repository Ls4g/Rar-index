import assert from "node:assert/strict";
import { apifyReviewDraft } from "../lib/apifyReviewDraft.ts";
import { APIFY_SOLD_SEARCH_PROVIDER } from "../lib/salesInbox.ts";

const today = "2026-10-20";
const row = (item, provider = APIFY_SOLD_SEARCH_PROVIDER) => ({ provider, item });
const item = {
  soldPrice: "24.99",
  soldCurrency: "gbp",
  endedAt: "2026-10-17",
  soldPriceMax: null,
  isBestOfferAccepted: false,
};

assert.deepEqual(apifyReviewDraft(row(item), false, today), {
  amount: "24.99", currency: "GBP", endedDate: "2026-10-17",
});
assert.deepEqual(apifyReviewDraft(row({ ...item, isBestOfferAccepted: true }), false, today), {
  amount: null, currency: "GBP", endedDate: "2026-10-17",
});
assert.equal(apifyReviewDraft(row(item), true, today)?.amount, null);
assert.equal(apifyReviewDraft(row({ ...item, soldPriceMax: "30.00" }), false, today)?.amount, null);
assert.equal(apifyReviewDraft(row({ ...item, soldPrice: "0" }), false, today)?.amount, null);
assert.equal(apifyReviewDraft(row({ ...item, soldPrice: "unavailable" }), false, today)?.amount, null);
assert.deepEqual(apifyReviewDraft(row({ ...item, soldCurrency: "???", endedAt: "2026-02-30" }), false, today), {
  amount: null, currency: null, endedDate: null,
});
assert.equal(apifyReviewDraft(row({ ...item, endedAt: "2026-10-21" }), false, today)?.endedDate, null);
assert.equal(apifyReviewDraft(row(item, "another_provider"), false, today), null);
assert.equal(apifyReviewDraft(null, false, today), null);

console.log("Apify review draft: all checks passed.");
