import assert from "node:assert/strict";
import { prepareSaleDecision } from "../lib/preparedSaleDecision.ts";

const check = (overrides = {}) => ({
  provider: "eBay Trading GetItem", state: "completed_sold", httpStatus: 200,
  checkedAt: "2026-10-22T12:00:00Z",
  rawResponse: { final_response: {
    listingStatus: "completed", quantitySold: 1,
    price: { value: 42, currency: "GBP" }, endTime: "2026-10-21T18:00:00Z",
    title: "Naruto Vol. 1 English VIZ Manga", bestOfferEnabled: false,
    imageUrls: ["https://i.ebayimg.com/images/g/photo/s-l1600.jpg"], itemSpecifics: [],
    ...overrides,
  } },
});
const row = (overrides = {}) => ({
  id: "outcome-1", externalId: "123456789012", status: "sold_candidate",
  sourceListingUrl: "https://www.ebay.co.uk/itm/123456789012",
  listingTitle: "Naruto Vol. 1 English VIZ Manga", soldPrice: 42,
  soldCurrency: "GBP", soldAt: "2026-10-21T18:00:00Z", buyingFormat: "AUCTION",
  matchConflicts: [], checks: [check()], ...overrides,
});

const raw = prepareSaleDecision(row());
assert.equal(raw.ready, true);
assert.equal(raw.grading, "raw");
assert.equal(raw.printing, "printing_not_identified");
assert.equal(raw.imageUrls.length, 1);

const graded = prepareSaleDecision(row({
  listingTitle: "Naruto Vol. 1 CGC 9.8",
  checks: [check({ title: "Naruto Vol. 1 CGC 9.8" })],
}));
assert.equal(graded.ready, true);
assert.equal(graded.grading, "graded");
assert.equal(graded.gradingCompany, "CGC");
assert.equal(graded.gradeLabel, "9.8");

assert.equal(prepareSaleDecision(row({ buyingFormat: "BEST_OFFER" })).ready, false);
assert.match(prepareSaleDecision(row({ checks: [check({ quantitySold: 2 })] })).reason, /more than one copy/);
assert.match(prepareSaleDecision(row({ soldPrice: 99 })).reason, /does not agree/);
assert.match(prepareSaleDecision(row({ matchConflicts: ["wrong publisher"] })).reason, /Edition conflict/);
assert.match(prepareSaleDecision(row({ sourceListingUrl: "https://www.ebay.co.uk/itm/999999999999" })).reason, /do not match/);
assert.match(prepareSaleDecision(row({ checks: [check({ imageUrls: [] })] })).reason, /photos/);
assert.match(prepareSaleDecision(row({
  listingTitle: "Naruto Vol. 1 first print",
  checks: [check({ title: "Naruto Vol. 1 first print" })],
})).reason, /copyright-page/);
assert.match(prepareSaleDecision(row({
  listingTitle: "Naruto CGC graded",
  checks: [check({ title: "Naruto CGC graded" })],
})).reason, /exact grade/);
assert.match(prepareSaleDecision(row({
  listingTitle: "Dr Stone Manga Volumes 1 2 3",
  checks: [check({ title: "Dr Stone Manga Volumes 1 2 3" })],
})).reason, /multi-volume lot/);
assert.equal(prepareSaleDecision(row({ status: "ended_pending_check" })).ready, false);

console.log("Prepared sale decisions: all checks passed.");
