// Standalone sanity-check for the publication print-classification model.
// Run with:
//   node --experimental-strip-types scripts/test-print-classification.mjs
//
// Imports the real shipped logic directly — lib/printClassification.ts (the
// grouping/validation rules components/PublicationPrintTabs.tsx actually
// uses) and comparisonGroup() from lib/fx.ts (the same raw/graded split
// MarketValuePanel and PriceHistoryChart already use). No rule here is
// duplicated; this only asserts the real functions behave per AGENTS.md's
// evidence rules.
//
// What this script does NOT cover, because it isn't pure-function logic:
// publication/print-run redirects, and English/Japanese publications never
// merging, are query- and route-level behaviour verified live against the
// real Supabase project instead (see the session's verification notes).

import { isValidFirstPrintClaim, splitByPrintClassification, groupKnownLaterPrintSales, hasComparableChart, MIN_COMPARABLE_SALES } from "../lib/printClassification.ts";
import { comparisonGroup } from "../lib/fx.ts";

let failures = 0;
function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  } else {
    console.log(`ok: ${message}`);
  }
}

// --- 1. No first-print classification without proof ------------------------
assert(isValidFirstPrintClaim("https://i.ebayimg.com/example.jpg") === true, "a real proof URL is a valid first-print claim");
assert(isValidFirstPrintClaim(null) === false, "no proof URL is never a valid first-print claim");
assert(isValidFirstPrintClaim("") === false, "an empty proof URL is never a valid first-print claim");
assert(isValidFirstPrintClaim("   ") === false, "a whitespace-only proof URL is never a valid first-print claim");

// --- 2. Classification splitting is exhaustive and exclusive ----------------
const sampleSales = [
  { id: "a", print_classification: "first_print_proven", match_status: "verified_match", known_printing_number: 1 },
  { id: "b", print_classification: "first_print_proven", match_status: "verified_match", known_printing_number: 1 },
  { id: "c", print_classification: "known_later_print", match_status: "verified_match", known_printing_number: 3 },
  { id: "d", print_classification: "known_later_print", match_status: "verified_match", known_printing_number: 3 },
  { id: "e", print_classification: "known_later_print", match_status: "verified_match", known_printing_number: 5 },
  { id: "f", print_classification: "printing_not_identified", match_status: "verified_match", known_printing_number: null },
  { id: "g", print_classification: "printing_not_identified", match_status: "needs_review", known_printing_number: null },
];
const split = splitByPrintClassification(sampleSales);
assert(split.firstPrintProven.length === 2, "splitByPrintClassification finds exactly the first_print_proven sales");
assert(split.knownLaterPrint.length === 3, "splitByPrintClassification finds exactly the known_later_print sales");
assert(split.printingNotIdentified.length === 2, "splitByPrintClassification finds exactly the printing_not_identified sales");
assert(
  split.firstPrintProven.length + split.knownLaterPrint.length + split.printingNotIdentified.length === sampleSales.length,
  "every sale lands in exactly one classification group",
);

// --- 3. No combined valuation across different printing numbers -------------
const knownLaterGroups = groupKnownLaterPrintSales(split.knownLaterPrint);
assert(knownLaterGroups.size === 2, "known_later_print sales group by their own known_printing_number, not combined");
assert(knownLaterGroups.get(3)?.length === 2, "the 3rd-printing group contains only 3rd-printing sales");
assert(knownLaterGroups.get(5)?.length === 1, "the 5th-printing group contains only the 5th-printing sale");
assert(!knownLaterGroups.has(1), "first-print-proven sales never leak into a known-later-print group");

// printing_not_identified sales are never even given to the grouping/chart
// functions in the real component — confirm the chart-worthiness check
// still correctly refuses a tiny group regardless.
assert(hasComparableChart(knownLaterGroups.get(5)) === false, `a single-sale printing group needs ${MIN_COMPARABLE_SALES} before it can be charted`);
assert(hasComparableChart(knownLaterGroups.get(3)) === false, "two sales is still below the comparable-sales minimum");
const threeSaleGroup = [...knownLaterGroups.get(3), { id: "extra", print_classification: "known_later_print", match_status: "verified_match", known_printing_number: 3 }];
assert(hasComparableChart(threeSaleGroup) === true, "three verified sales in the same printing group is enough to chart");
assert(hasComparableChart([...threeSaleGroup.slice(0, 2), { id: "pending", match_status: "needs_review" }]) === false, "a needs_review sale never counts toward the comparable-sales minimum");

// --- 4. Raw and graded stay separate even within one printing group ---------
const mixedPrintingGroup = [
  { sold_date: "2026-01-01", sale_price: 100, currency: "USD", grading_company: null, grade_label: null },
  { sold_date: "2026-01-02", sale_price: 500, currency: "USD", grading_company: "CGC", grade_label: "9.8" },
];
const rawGroupKey = comparisonGroup(mixedPrintingGroup[0]).key;
const gradedGroupKey = comparisonGroup(mixedPrintingGroup[1]).key;
assert(rawGroupKey !== gradedGroupKey, "a raw sale and a graded sale in the same known-printing-number group still land in different comparison groups");
assert(rawGroupKey === "Raw", "an ungraded sale's comparison group is Raw");
assert(gradedGroupKey.startsWith("Graded"), "a graded sale's comparison group is labelled Graded");

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll print-classification assertions passed.");
