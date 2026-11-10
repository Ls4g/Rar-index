import assert from "node:assert/strict";
import { comparisonGroup, normaliseGradeLabel } from "../lib/fx.ts";

// Seen live on Naruto Vol. 1 (Japanese): "BGS 6" and "BGS 6.0" were separate
// one-sale groups, each with its own "median".
const sale = (grading_company, grade_label) => ({ sale_price: 1, currency: "USD", sold_date: "2026-09-13", grading_company, grade_label });
assert.equal(comparisonGroup(sale("BGS", "6")).key, comparisonGroup(sale("BGS", "6.0")).key);
assert.equal(comparisonGroup(sale("BGS", "6.0")).grading, "Graded · BGS 6.0");
assert.equal(comparisonGroup(sale("BGS", "10.0")).key, comparisonGroup(sale("BGS", "10")).key);

// Different grades and different companies stay apart.
assert.notEqual(comparisonGroup(sale("BGS", "6")).key, comparisonGroup(sale("BGS", "6.5")).key);
assert.notEqual(comparisonGroup(sale("BGS", "9")).key, comparisonGroup(sale("CGC", "9")).key);
assert.equal(comparisonGroup(sale("BGS", "9.4")).grading, "Graded · BGS 9.4");

// Raw stays raw, and a non-numeric label is never rewritten.
assert.equal(comparisonGroup(sale(null, null)).key, "Raw");
assert.equal(normaliseGradeLabel("Authentic"), "Authentic");
assert.equal(normaliseGradeLabel(" 8.50 "), "8.5");
assert.equal(normaliseGradeLabel(null), "");
console.log("Grade label grouping: passed");
