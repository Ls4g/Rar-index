// Whether an edition has a price RAR would stand behind.
//
//   node --experimental-strip-types scripts/test-edition-price-coverage.mjs
//
// The page this drives replaced a queue of 2,945 listings that nobody could
// finish. Its whole value is that "priced" means something strict, so the
// assertions here are mostly about what must NOT count as a price:
// three sales spread across two printings, or across two currencies, or all
// from last spring.
import assert from "node:assert/strict";
import {
  assessEditionCoverage,
  coverageSummary,
  PRICE_CURRENT_WITHIN_DAYS,
  sortCoverage,
} from "../lib/editionPriceCoverage.ts";
import { MIN_COMPARABLE_SALES } from "../lib/printClassification.ts";

const NOW = new Date("2026-10-19T00:00:00.000Z");
const EDITION = { id: "e1", title: "One Piece, Vol. 1", series: "One Piece", volume_number: "1", language: "English", isbn_13: "9781569319017" };
const OTHER = { id: "e2", title: "Naruto, Vol. 1", series: "Naruto", volume_number: "1", language: "English", isbn_13: "9781569319024" };

function sale(overrides = {}) {
  return {
    sold_date: "2026-10-01",
    sale_price: 10,
    currency: "USD",
    grading_company: null,
    grade_label: null,
    print_classification: "printing_not_identified",
    known_printing_number: null,
    ...overrides,
  };
}

const days = (n) => new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10);

const checks = [];
function check(label, fn) {
  try {
    fn();
    checks.push({ label, ok: true });
  } catch (error) {
    checks.push({ label, ok: false, error: error.message });
  }
}

check("no sales is 'none', with no price invented", () => {
  const row = assessEditionCoverage(EDITION, [], 0, NOW);
  assert.equal(row.state, "none");
  assert.equal(row.medianPrice, null);
  assert.equal(row.currency, null);
});

check("three recent comparable sales is 'priced', and the price is their median", () => {
  const row = assessEditionCoverage(EDITION, [
    sale({ sale_price: 10 }), sale({ sale_price: 20 }), sale({ sale_price: 60 }),
  ], 0, NOW);
  assert.equal(row.state, "priced");
  assert.equal(row.medianPrice, 20, "median, not mean -- a 60 outlier must not drag the figure");
  assert.equal(row.comparableSales, 3);
});

check("two sales is never a price, however recent", () => {
  const row = assessEditionCoverage(EDITION, [sale(), sale()], 0, NOW);
  assert.equal(row.state, "thin");
  assert.equal(row.comparableSales, 2);
  assert.ok(row.medianPrice !== null, "a figure is still shown, it is just not called a price");
});

check(`enough sales but all older than ${PRICE_CURRENT_WITHIN_DAYS} days is 'stale', not 'priced'`, () => {
  const old = days(PRICE_CURRENT_WITHIN_DAYS + 10);
  const row = assessEditionCoverage(EDITION, [
    sale({ sold_date: old }), sale({ sold_date: old }), sale({ sold_date: old }),
  ], 0, NOW);
  assert.equal(row.state, "stale");
  assert.equal(row.latestSaleDate, old);
});

check("a sale exactly on the window boundary still counts as current", () => {
  const edge = days(PRICE_CURRENT_WITHIN_DAYS);
  const row = assessEditionCoverage(EDITION, [
    sale({ sold_date: edge }), sale({ sold_date: edge }), sale({ sold_date: edge }),
  ], 0, NOW);
  assert.equal(row.state, "priced");
});

check("three sales split across two printings is NOT a price", () => {
  // A first printing and a fifth printing are different markets. Medianing
  // them would invent a number describing neither.
  const row = assessEditionCoverage(EDITION, [
    sale({ print_classification: "first_print_proven", sale_price: 400 }),
    sale({ print_classification: "known_later_print", known_printing_number: 5, sale_price: 8 }),
    sale({ print_classification: "known_later_print", known_printing_number: 5, sale_price: 9 }),
  ], 0, NOW);
  assert.equal(row.state, "thin", `expected thin, got ${row.state} with ${row.comparableSales} comparable`);
  assert.ok(row.comparableSales < MIN_COMPARABLE_SALES);
  assert.equal(row.totalSales, 3, "all three are still reported as sales for the edition");
});

check("three sales split across two currencies is NOT a price", () => {
  const row = assessEditionCoverage(EDITION, [
    sale({ currency: "USD", sale_price: 10 }),
    sale({ currency: "GBP", sale_price: 10 }),
    sale({ currency: "GBP", sale_price: 12 }),
  ], 0, NOW);
  assert.equal(row.state, "thin");
  assert.equal(row.currency, "GBP", "the most-supported currency is the one quoted");
  assert.equal(row.comparableSales, 2);
});

check("a graded copy is not comparable with a raw one", () => {
  const row = assessEditionCoverage(EDITION, [
    sale({ grading_company: "CGC", grade_label: "9.8", sale_price: 500 }),
    sale({ sale_price: 10 }),
    sale({ sale_price: 12 }),
  ], 0, NOW);
  assert.equal(row.state, "thin");
  assert.equal(row.comparableSales, 2, "the graded sale must not join the raw group");
});

check("the summary counts every edition exactly once", () => {
  const rows = [
    assessEditionCoverage(EDITION, [sale(), sale(), sale()], 0, NOW),
    assessEditionCoverage(OTHER, [sale()], 4, NOW),
    assessEditionCoverage({ ...OTHER, id: "e3" }, [], 2, NOW),
  ];
  const summary = coverageSummary(rows);
  assert.equal(summary.total, 3);
  assert.equal(summary.priced + summary.stale + summary.thin + summary.none, 3);
  assert.equal(summary.priced, 1);
  assert.equal(summary.waitingToCheck, 6);
});

check("the order puts work first and finished editions last", () => {
  const priced = assessEditionCoverage(EDITION, [sale(), sale(), sale()], 0, NOW);
  const thinBusy = assessEditionCoverage({ ...OTHER, id: "e4" }, [sale()], 9, NOW);
  const thinQuiet = assessEditionCoverage({ ...OTHER, id: "e5" }, [sale()], 0, NOW);
  const empty = assessEditionCoverage({ ...OTHER, id: "e6" }, [], 0, NOW);
  const order = sortCoverage([priced, thinQuiet, empty, thinBusy]).map((row) => row.edition.id);
  assert.deepEqual(order, ["e4", "e5", "e6", "e1"],
    "expected: listings waiting first, then thin, then empty, then priced");
});

check("the same input always sorts the same way", () => {
  // A tiebreak that varies between requests makes paging skip or repeat rows.
  const rows = ["a", "b", "c"].map((id) => assessEditionCoverage({ ...EDITION, id }, [sale()], 3, NOW));
  const first = sortCoverage(rows).map((row) => row.edition.id);
  const again = sortCoverage([...rows].reverse()).map((row) => row.edition.id);
  assert.deepEqual(first, again);
});

for (const result of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}`);
  if (!result.ok) console.log(`      ${result.error}`);
}
const failed = checks.filter((result) => !result.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
