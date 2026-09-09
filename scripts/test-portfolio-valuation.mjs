import assert from "node:assert/strict";
import { computeEditionMetrics } from "../lib/portfolioValuation.ts";

const holding = (printingNumber = 1) => ({
  id: "holding", edition_id: "publication", quantity: 1,
  purchase_price: null, purchase_currency: null, purchase_date: null,
  edition: { id: "publication", printing_of_edition_id: null, printing_number: printingNumber },
});
const sale = (overrides = {}) => ({
  edition_id: "publication", sale_price: 20, currency: "GBP", sold_date: "2026-08-01",
  print_classification: "first_print_proven", known_printing_number: 1,
  grading_company: null, grade_label: null, ...overrides,
});
const family = new Map([["publication", "publication"]]);

assert.equal(computeEditionMetrics([holding()], [sale(), sale(), sale({ grading_company: "CGC", grade_label: "9.8" })], family).metrics.length, 0, "raw and graded sales must not combine to reach three");
assert.equal(computeEditionMetrics([holding()], [sale(), sale()], family).metrics.length, 0, "two comparable sales must not create a value");

const threeRaw = [sale({ sale_price: 10 }), sale({ sale_price: 20 }), sale({ sale_price: 90 })];
const qualified = computeEditionMetrics([holding()], threeRaw, family).metrics;
assert.equal(qualified.length, 1);
assert.equal(qualified[0].market_value_median, 20);
assert.equal(qualified[0].verified_sale_count, 3);

const mixedPrintings = [sale(), sale(), sale({ print_classification: "known_later_print", known_printing_number: 3 })];
assert.equal(computeEditionMetrics([holding()], mixedPrintings, family).metrics.length, 0, "different printings must not combine");
assert.equal(computeEditionMetrics([holding(null)], threeRaw, family).metrics.length, 0, "a holding with no printing claim must not inherit a first-print value");

const threeUnknown = [sale({ print_classification: "printing_not_identified", known_printing_number: null, sale_price: 10 }), sale({ print_classification: "printing_not_identified", known_printing_number: null, sale_price: 20 }), sale({ print_classification: "printing_not_identified", known_printing_number: null, sale_price: 90 })];
const publicationMetric = computeEditionMetrics([holding(null)], threeUnknown, family).metrics[0];
assert.equal(publicationMetric.market_value_median, 20, "a publication with no printing claim uses only the matching unidentified-print group");
assert.equal(publicationMetric.print_classification, "printing_not_identified");
assert.equal(computeEditionMetrics([holding()], threeUnknown, family).metrics.length, 0, "unidentified-print sales must not value a proven first-print holding");

const twoCurrencies = [...threeRaw, sale({ currency: "USD" }), sale({ currency: "USD" }), sale({ currency: "USD" })];
assert.equal(computeEditionMetrics([holding()], twoCurrencies, family).metrics.length, 1, "alternative currency medians must not be added together");

console.log("Portfolio valuation evidence-bar checks passed.");
