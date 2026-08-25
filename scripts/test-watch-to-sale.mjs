// Watch-to-Sale classification tests. Run with:
//   node --experimental-strip-types scripts/test-watch-to-sale.mjs
//
// These cover the cases where getting it wrong would put a fabricated sale on
// a public chart. The rule under test throughout is that only an explicit
// completed-sale signal carrying a usable price AND date may become a
// candidate -- and a candidate is still only a queue entry for a human.
import {
  classifyListingOutcome,
  exhaustedOutcome,
  isDueForCheck,
  nextOutcomeCheckAt,
  MAX_OUTCOME_ATTEMPTS,
} from "../lib/listingOutcome.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

const base = {
  provider: "eBay Marketplace Insights",
  listingState: "unknown",
  soldPrice: null, soldCurrency: null, soldAt: null,
  bidCount: null, buyingFormat: null, bestOfferAccepted: null,
  scheduledEndAt: null, httpStatus: 200, detail: "",
};
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

console.log("\n--- sales that should be believed ---");
const auction = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: 240, soldCurrency: "GBP", soldAt: yesterday, buyingFormat: "AUCTION", bidCount: 14 });
check("confirmed auction sale becomes a candidate", auction.status === "sold_candidate" && auction.soldPrice === 240, JSON.stringify(auction));

const fixed = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: 99.5, soldCurrency: "USD", soldAt: yesterday, buyingFormat: "FIXED_PRICE" });
check("confirmed fixed-price sale becomes a candidate", fixed.status === "sold_candidate" && fixed.soldCurrency === "USD");

console.log("\n--- things that are NOT sales ---");
const unsold = classifyListingOutcome({ ...base, listingState: "completed_unsold", buyingFormat: "AUCTION", bidCount: 0 });
check("explicit unsold auction resolves as unsold", unsold.status === "unsold");

const bidsNoSale = classifyListingOutcome({ ...base, listingState: "unknown", bidCount: 23, buyingFormat: "AUCTION", detail: "ended, no sale confirmation" });
check("ended with 23 bids but no confirmation is never sold", bidsNoSale.status !== "sold_candidate" && bidsNoSale.status === "ambiguous", JSON.stringify(bidsNoSale));

const unsoldWithBids = classifyListingOutcome({ ...base, listingState: "completed_unsold", bidCount: 9 });
check("bids on an explicitly unsold listing stay unsold", unsoldWithBids.status === "unsold");

const bestOffer = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: 300, soldCurrency: "GBP", soldAt: yesterday, buyingFormat: "FIXED_PRICE,BEST_OFFER" });
check("Best Offer without an accepted price is ambiguous", bestOffer.status === "ambiguous" && bestOffer.soldPrice === null, JSON.stringify(bestOffer));

const bestOfferAccepted = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: 275, soldCurrency: "GBP", soldAt: yesterday, buyingFormat: "FIXED_PRICE,BEST_OFFER", bestOfferAccepted: true });
check("Best Offer WITH the accepted price is a candidate", bestOfferAccepted.status === "sold_candidate" && bestOfferAccepted.soldPrice === 275);

const removed = classifyListingOutcome({ ...base, provider: "eBay Browse", listingState: "not_found", httpStatus: 404, bidCount: 5 });
check("removed listing is inaccessible, never sold", removed.status === "inaccessible");

const stillActive = classifyListingOutcome({ ...base, provider: "eBay Browse", listingState: "active" });
check("listing still live after its expected end stays active", stillActive.status === "active" && stillActive.resolved === false);

console.log("\n--- incomplete sale data ---");
const noPrice = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: null, soldCurrency: "GBP", soldAt: yesterday });
check("completed sale without a price is ambiguous", noPrice.status === "ambiguous");

const zeroPrice = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: 0, soldCurrency: "GBP", soldAt: yesterday });
check("a zero price is not a price", zeroPrice.status === "ambiguous");

const noDate = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: 120, soldCurrency: "GBP", soldAt: null });
check("completed sale without a date is ambiguous", noDate.status === "ambiguous");

const futureDate = classifyListingOutcome({ ...base, listingState: "completed_sold", soldPrice: 120, soldCurrency: "GBP", soldAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
check("a sale dated in the future is not usable", futureDate.status === "ambiguous");

console.log("\n--- API failure and retries ---");
const apiFailure = classifyListingOutcome({ ...base, provider: "eBay Browse", listingState: "unknown", httpStatus: 503, detail: "eBay Browse returned HTTP 503." });
check("temporary API failure is ambiguous and unresolved", apiFailure.status === "ambiguous" && apiFailure.resolved === false);

const missingCreds = classifyListingOutcome({ ...base, provider: "eBay Browse", listingState: "unknown", httpStatus: null, detail: "eBay application credentials are not configured." });
check("missing credentials never classify a listing", missingCreds.status === "ambiguous" && missingCreds.resolved === false);

check("retry schedule backs off", nextOutcomeCheckAt(0) !== null && new Date(nextOutcomeCheckAt(1)) > new Date(nextOutcomeCheckAt(0)));
check("retries are finite", nextOutcomeCheckAt(MAX_OUTCOME_ATTEMPTS) === null);
const exhausted = exhaustedOutcome("eBay Browse", MAX_OUTCOME_ATTEMPTS);
check("retry exhaustion records unknown, not unsold", exhausted.status === "ambiguous" && exhausted.resolved === true);

console.log("\n--- scheduling ---");
const future = new Date(Date.now() + 3_600_000).toISOString();
check("a listing that has not ended is never checked", !isDueForCheck({ status: "ended_pending_check", next_check_at: null, scheduled_end_at: future }));
check("an ended listing with no scheduled check is due", isDueForCheck({ status: "ended_pending_check", next_check_at: null, scheduled_end_at: yesterday }));
check("a resolved listing is never rechecked", !isDueForCheck({ status: "unsold", next_check_at: null, scheduled_end_at: yesterday }));
check("a confirmed sale is never rechecked", !isDueForCheck({ status: "review_complete", next_check_at: null, scheduled_end_at: yesterday }));
check("a sold candidate awaiting review is not rechecked", !isDueForCheck({ status: "sold_candidate", next_check_at: null, scheduled_end_at: yesterday }));
check("a check scheduled for later is not due yet", !isDueForCheck({ status: "ended_pending_check", next_check_at: future, scheduled_end_at: yesterday }));

console.log("\n--- listings with no end date ---");
// eBay publishes an end date for auctions and not for fixed-price listings.
// The first live capture pulled 25 real Scout listings and every one had a
// null end time, so this is the normal case rather than an edge case: without
// handling it the pipeline would capture listings and then never check any.
check("a fixed-price listing with no end date is checkable once promoted",
  isDueForCheck({ status: "ended_pending_check", next_check_at: null, scheduled_end_at: null }));
check("but is not checked while it is still being seen live",
  !isDueForCheck({ status: "active", next_check_at: future, scheduled_end_at: null }));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
