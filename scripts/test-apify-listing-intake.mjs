// Apify rows must become listings to CHECK, never sales.
//
//   node --experimental-strip-types scripts/test-apify-listing-intake.mjs
//
// The danger this guards against is a specific one. Apify returns rows from
// eBay's sold-listings search index, and every row carries a price and a
// date. Those two fields are exactly what listing_outcomes reserves for a
// confirmed sale. Copying them across would manufacture evidence out of a
// scraper's echo of its own search filter -- the index has returned listings
// whose own item page says the seller simply ended them.
//
// So the assertions below are mostly about what must NOT appear in a built
// row, and about which rows never get that far.
import assert from "node:assert/strict";
import { buildOutcomeRow, classifyApifyRow, indexEditionsByIsbn, priceDisqualifier } from "../lib/apifyListingIntake.ts";

const EDITION = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Attack on Titan, Vol. 1",
  series: "Attack on Titan",
  volume_number: "1",
  language: "English",
  isbn_13: "9781612620244",
  publisher: "Kodansha",
  format: "Paperback",
  printing_number: null,
  edition_statement: null,
  variant_name: null,
  collectible_type: "tankobon",
};

const VARIANT = { ...EDITION, id: "22222222-2222-2222-2222-222222222222", printing_number: 9, variant_name: "Gold Foil" };

const byIsbn = indexEditionsByIsbn([EDITION]);
const bySharedIsbn = indexEditionsByIsbn([EDITION, VARIANT]);

const SOUND_ROW = {
  itemId: "298739416531",
  title: "Attack on Titan 1 by Isayama, Hajime",
  url: "https://www.ebay.com/itm/298739416531?nordt=true",
  keyword: "9781612620244",
  endedAt: "2026-10-17",
  soldPrice: "3.99",
  soldPriceMax: null,
  soldCurrency: "USD",
  isBestOfferAccepted: false,
  buyingFormat: "buyItNow",
  listingType: "buy_it_now",
  bidCount: null,
  fullResThumbnailUrl: "https://i.ebayimg.com/images/g/x/s-l1600.webp",
};

const checks = [];
function check(label, fn) {
  try {
    fn();
    checks.push({ label, ok: true });
  } catch (error) {
    checks.push({ label, ok: false, error: error.message });
  }
}

check("a sound row is queued against the edition its ISBN names", () => {
  const decision = classifyApifyRow(SOUND_ROW, byIsbn);
  assert.equal(decision.kind, "queue");
  assert.equal(decision.pick.edition.id, EDITION.id);
});

check("a built row carries no sale: no price, no currency, no date, no observation", () => {
  const decision = classifyApifyRow(SOUND_ROW, byIsbn);
  const row = buildOutcomeRow(SOUND_ROW, decision.pick, "33333333-3333-3333-3333-333333333333");
  for (const column of ["sold_price", "sold_currency", "sold_at", "resulting_observation_id", "reviewed_by", "reviewed_at"]) {
    assert.ok(!(column in row), `${column} must never be written by discovery; found ${JSON.stringify(row[column])}`);
  }
  assert.equal(row.status, "ended_pending_check", "a discovered listing is only ever queued for a check");
});

check("Apify's price is not laundered into the sale columns via asking_price", () => {
  // asking_price is legitimate for a buy-it-now, where the figure eBay's index
  // shows IS the listed price. What must not happen is it reappearing as
  // sold_price, or an auction's winning bid being filed as an asking price.
  const decision = classifyApifyRow(SOUND_ROW, byIsbn);
  const buyItNow = buildOutcomeRow(SOUND_ROW, decision.pick, "s");
  assert.equal(buyItNow.asking_price, 3.99);
  assert.equal(buyItNow.currency, "USD");

  const auction = { ...SOUND_ROW, listingType: "auction", buyingFormat: "auction", bidCount: 7 };
  const auctionDecision = classifyApifyRow(auction, byIsbn);
  const auctionRow = buildOutcomeRow(auction, auctionDecision.pick, "s");
  assert.equal(auctionRow.asking_price, null, "an auction's winning bid is not an asking price");
  assert.equal(auctionRow.currency, null);
});

check("the stored link and the stored item id always agree", () => {
  // outcomeSaleConfirmation refuses to confirm a sale when these disagree, so
  // a row that could never be confirmed must not reach the queue.
  const decision = classifyApifyRow(SOUND_ROW, byIsbn);
  const row = buildOutcomeRow(SOUND_ROW, decision.pick, "s");
  const idInUrl = /\/itm\/(\d+)/.exec(String(row.source_listing_url))[1];
  assert.equal(idInUrl, row.external_id);

  const mismatched = { ...SOUND_ROW, url: "https://www.ebay.com/itm/999999999999?nordt=true" };
  assert.equal(classifyApifyRow(mismatched, byIsbn).kind, "drop");
  assert.match(priceDisqualifier(mismatched), /points at item 999999999999/);
});

check("an accepted Best Offer stays review-only until eBay shows the actual paid price", () => {
  const bestOffer = { ...SOUND_ROW, isBestOfferAccepted: true };
  const decision = classifyApifyRow(bestOffer, byIsbn);
  assert.equal(decision.kind, "queue");
  const row = buildOutcomeRow(bestOffer, decision.pick, "s");
  assert.equal(row.status, "ended_pending_check");
  assert.equal(row.buying_format, "BEST_OFFER");
  assert.equal(row.asking_price, null, "the search-row price is neither a verified sale nor a safe asking price");
  assert.equal(row.currency, null);
  assert.ok(!("sold_price" in row));
});

check("a price range is dropped, because it is not one sale", () => {
  const decision = classifyApifyRow({ ...SOUND_ROW, soldPriceMax: "12.00" }, byIsbn);
  assert.equal(decision.kind, "drop");
});

check("a multi-volume lot is dropped", () => {
  const decision = classifyApifyRow({ ...SOUND_ROW, title: "Attack on Titan Manga Lot Volumes 1,2,3 1-3" }, byIsbn);
  assert.equal(decision.kind, "drop");
});

check("an ISBN RAR does not hold is dropped, not guessed at", () => {
  const decision = classifyApifyRow({ ...SOUND_ROW, keyword: "9780000000000" }, byIsbn);
  assert.equal(decision.kind, "drop");
  assert.match(decision.why, /not in the catalogue/);
});

check("a free-text search is dropped, because it names no edition", () => {
  const decision = classifyApifyRow({ ...SOUND_ROW, keyword: "attack on titan manga" }, byIsbn);
  assert.equal(decision.kind, "drop");
});

check("two printings on one ISBN go to a person unless the title separates them", () => {
  const silent = classifyApifyRow(SOUND_ROW, bySharedIsbn);
  assert.equal(silent.kind, "human", "a title that says nothing must not pick a printing");
  assert.equal(silent.candidates.length, 2);

  const named = classifyApifyRow({ ...SOUND_ROW, title: "Attack on Titan 1 Gold Foil cover" }, bySharedIsbn);
  assert.equal(named.kind, "queue");
  assert.equal(named.pick.edition.id, VARIANT.id, "a title naming the variant should resolve to it");
});

check("the eBay marketplace comes from the listing's own domain", () => {
  const decision = classifyApifyRow(SOUND_ROW, byIsbn);
  assert.equal(buildOutcomeRow(SOUND_ROW, decision.pick, "s").marketplace, "EBAY_US");

  const uk = { ...SOUND_ROW, url: "https://www.ebay.co.uk/itm/298739416531" };
  const ukDecision = classifyApifyRow(uk, byIsbn);
  assert.equal(buildOutcomeRow(uk, ukDecision.pick, "s").marketplace, "EBAY_GB");
});

check("the snapshot keeps Apify's row verbatim and says where it came from", () => {
  const decision = classifyApifyRow(SOUND_ROW, byIsbn);
  const row = buildOutcomeRow(SOUND_ROW, decision.pick, "s");
  assert.equal(row.original_snapshot.provider, "apify_ebay_sold_search");
  assert.deepEqual(row.original_snapshot.item, SOUND_ROW);
  assert.match(String(row.outcome_reason), /not proof of sale/);
});

for (const result of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}`);
  if (!result.ok) console.log(`      ${result.error}`);
}
const failed = checks.filter((result) => !result.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
