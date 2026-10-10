import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPriceSeries } from "../lib/priceSeries.ts";

// Exercise the actual homepage projection: omission of conflict fields used
// to turn an unresolved graded title into the third sale in a raw chart.
const source = readFileSync(new URL("../components/ConceptExperience.tsx", import.meta.url), "utf8");
const columns = source.match(/from\("price_observations"\)\s*\.select\("([^"]+)"\)/)[1].split(",");
const base = { sold_date: "2026-10-01", sale_price: 20, currency: "GBP", grading_company: null, grade_label: null, grading_reviewed_at: null, print_classification: "printing_not_identified", known_printing_number: null };
const raw = { ...base, listing_title: "Raw manga volume 1" };
const conflict = { ...base, listing_title: "BGS 9.8 graded manga volume 1" };
const project = (sale) => Object.fromEntries(columns.map((key) => [key, sale[key]]));
const series = buildPriceSeries([raw, raw, conflict].map(project));
assert.equal(series.length, 1);
assert.equal(series[0].sales.length, 2);
assert.equal(series[0].chartable, false);
const reviewed = buildPriceSeries([raw, raw, { ...conflict, grading_reviewed_at: "2026-10-02" }].map(project));
assert.equal(reviewed[0].chartable, true, "a human-confirmed raw copy remains eligible");
const graded = buildPriceSeries([raw, raw, { ...conflict, grading_company: "BGS", grade_label: "9.8" }].map(project));
assert.equal(graded.length, 2);
assert.ok(graded.every((group) => !group.chartable), "separate raw and graded groups cannot pool to reach three");
console.log("Homepage projection preserves grading conflicts, human resolutions, and separate comparison groups.");
