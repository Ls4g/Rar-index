import assert from "node:assert/strict";
import {
  compareCoverResearchPriority,
  coveragePriorityRank,
  coverageStrength,
  isCoveragePrioritySeries,
} from "../lib/coveragePriority.ts";

assert.equal(coveragePriorityRank("One Piece"), 0, "the first staff-ranked subject stays first");
assert.equal(coveragePriorityRank("Detective Conan"), 3, "an alternate title maps to the intended priority");
assert.equal(coveragePriorityRank("Hunter × Hunter"), 20, "typographic multiplication signs normalize safely");
assert.equal(isCoveragePrioritySeries("An unrelated title"), false, "ordinary catalogue titles are not promoted");

assert.deepEqual(
  coverageStrength({ coverVerified: true, hasActiveProfile: true, comparableSaleCount: 5 }),
  { completed: 3, total: 3, strong: true, missing: [] },
  "five comparable sales plus cover and profile is strong coverage",
);
assert.deepEqual(
  coverageStrength({ coverVerified: true, hasActiveProfile: false, comparableSaleCount: 3 }),
  { completed: 1, total: 3, strong: false, missing: ["marketplace profile", "2 comparable sales"] },
  "the dashboard names every remaining gap without weakening the evidence target",
);

const ordinaryUnscanned = { series: "Ordinary Series", verified_sale_count: 20, lastScan: null };
const priorityScanned = { series: "Doraemon", verified_sale_count: 0, lastScan: "2026-09-01T00:00:00.000Z" };
assert(compareCoverResearchPriority(priorityScanned, ordinaryUnscanned) < 0, "priority editions reach cover research before ordinary records");
assert(compareCoverResearchPriority(
  { series: "Doraemon", verified_sale_count: 0, lastScan: "2026-09-01T00:00:00.000Z" },
  { series: "Golgo 13", verified_sale_count: 0, lastScan: null },
) > 0, "an unscanned priority edition is not starved by a higher-ranked edition that was just checked");

console.log("Priority coverage tests passed.");
