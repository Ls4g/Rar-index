import assert from "node:assert/strict";
import { collectorMarketGuide } from "../lib/collectorMarketGuide.ts";

function sale(overrides = {}) {
  return {
    sale_status: "confirmed",
    match_status: "verified_match",
    source_listing_url: "https://www.ebay.co.uk/itm/123456789012",
    listing_title: "One Piece Vol. 1 manga",
    sold_date: "2026-09-10",
    sale_price: 60,
    currency: "GBP",
    grading_company: null,
    grade_label: null,
    print_classification: "first_print_proven",
    printing_proof_url: "https://www.ebay.co.uk/itm/123456789012",
    known_printing_number: null,
    ...overrides,
  };
}

assert.equal(collectorMarketGuide([sale(), sale({ sale_price: 80 })]), null, "two sales are not a price guide");
assert.deepEqual(collectorMarketGuide([
  sale({ sale_price: 40 }), sale({ sale_price: 60 }), sale({ sale_price: 80 }),
]), { currency: "GBP", median: 60, comparisonLabel: "Raw first print", saleCount: 3 });

assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ currency: "USD", sale_price: 100 }),
]), null, "different currencies cannot silently form one median");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ print_classification: "known_later_print", known_printing_number: 2 }),
]), null, "first and later printings cannot pool");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ grading_company: "CGC", grade_label: "9.8", sale_price: 500 }),
]), null, "raw and graded copies cannot pool");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ source_listing_url: null, sale_price: 90 }),
]), null, "a missing original source cannot become a public price");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ sale_status: "active", sale_price: 90 }),
]), null, "live listings cannot become a public price");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ sale_price: 0 }),
]), null, "zero-price rows cannot become a public price");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ print_classification: "printing_not_identified", sale_price: 90 }),
]), null, "unidentified printing cannot stand in for a first-print median");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ listing_title: "BGS 9.0 One Piece Vol. 1", sale_price: 500 }),
]), null, "unresolved grading in the listing title cannot contaminate raw evidence");
assert.equal(collectorMarketGuide([
  sale(), sale({ sale_price: 70 }), sale({ printing_proof_url: null, sale_price: 90 }),
]), null, "a first-print claim without proof cannot enter the median");
assert.equal(collectorMarketGuide([
  sale({ print_classification: "known_later_print", known_printing_number: null }),
  sale({ print_classification: "known_later_print", known_printing_number: null }),
  sale({ print_classification: "known_later_print", known_printing_number: null }),
]), null, "different unnumbered later printings cannot form one median");
assert.equal(collectorMarketGuide([
  sale({ listing_title: "Kagurabachi Vol 1 Manga First Edition w/Rare Bonus Illustration Card OBI Japan", sale_price: 460.85 }),
  sale({ listing_title: "Kagurabachi 1st Print Vol 1 Obi First Edition Manga Japanese 2024 w/shrink", sale_price: 555.93 }),
  sale({ listing_title: "Kagurabachi Vol.1 First Print Edition Japanese Manga w/Shrink & Obi New", sale_price: 529.98 }),
]), null, "a book bundled with a bonus card cannot form a clean book-price median");

console.log("Collector market guide: 13 representative evidence checks passed.");
