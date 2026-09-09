import assert from "node:assert/strict";
import { createScoutMemory, editionMatchOutcome, learningGroups, measureScoutConfidence, prospectiveHoldout, splitLearningDecisions } from "../lib/scoutLearningEvidence.ts";
import { evaluateScoutRule } from "../lib/scoutRuleEvaluation.ts";
import { defaultRuleConfig } from "../lib/scoutRules.ts";
import { assessScoutListing } from "../lib/scoutIngest.ts";

const edition = { title: "Bleach", series: "Bleach", volume_number: "1", language: "English", publisher: "VIZ Media", isbn_13: null, format: "Paperback", printing_number: 1 };
function row(i, extra = {}) {
  return { decisionId: `d${i}`, leadId: `l${i}`, listingKey: `ebay:${i}`, reviewer: "SP", decidedAt: "2026-09-10T00:00:00Z",
    decision: "watching", learningLabel: "exact_match", listingTitle: `Bleach Vol 1 English Manga First Print copy ${i}`, edition, ...extra };
}
assert.equal(editionMatchOutcome(row(1, { learningLabel: "interesting_opportunity" })), null);
for (const label of ["graded_not_raw", "poor_value", "unavailable", "printing_unproven", "duplicate_listing", null]) {
  assert.equal(editionMatchOutcome(row(1, { decision: "dismissed", learningLabel: label })), null);
}
assert.equal(editionMatchOutcome(row(1, { decision: "dismissed", learningLabel: "edition_mismatch" })), false);
assert.equal(editionMatchOutcome(row(1, { decision: "dismissed" })), null);

const corpus = Array.from({ length: 240 }, (_, i) => {
  const series = ["Bleach", "Naruto", "One Piece"][i % 3];
  return row(i, { edition: { ...edition, title: series, series },
    decision: i % 2 ? "watching" : "dismissed", learningLabel: i % 2 ? "exact_match" : "printing_unproven",
    listingTitle: `${series} Vol 1 English Manga ${i % 2 ? "First Print" : ""} sellerref${i}` });
});
const split = splitLearningDecisions(corpus);
assert.ok(split.holdout.length > 10 && split.development.length > split.holdout.length);
assert.deepEqual(new Set(split.holdout.map(x => x.leadId)), new Set(splitLearningDecisions([...corpus].reverse()).holdout.map(x => x.leadId)));
const duplicates = [row(1), row(1, { leadId: "other-profile", decisionId: "other-decision", listingTitle: "An edited title" }), row(2, { listingTitle: row(1).listingTitle })];
assert.equal(learningGroups(duplicates).length, 1);
assert.ok([0, 3].includes(splitLearningDecisions(duplicates).holdout.length));
assert.equal(measureScoutConfidence(duplicates).buckets[0].samples, 1);
assert.equal(measureScoutConfidence([row(1), row(1, { decision: "dismissed", learningLabel: "edition_mismatch" })]).buckets.length, 0);
assert.equal(prospectiveHoldout(corpus).length, 0);
assert.equal(prospectiveHoldout(corpus, "2026-09-11T00:00:00Z").length, 0);
const testCase = split.holdout[0];
assert.equal(prospectiveHoldout([testCase, { ...testCase, decidedAt: "2026-08-01T00:00:00Z" }], "2026-09-09T00:00:00Z").length, 0);
assert.equal(prospectiveHoldout([{ ...testCase, firstSeenAt: "2026-08-01T00:00:00Z" }], "2026-09-09T00:00:00Z").length, 0);

const report = measureScoutConfidence(Array.from({ length: 25 }, (_, i) => row(i)));
assert.equal(report.buckets[0].samples, 25);
assert.equal(report.buckets[0].observedMatchPercent, 100);
assert.ok(report.buckets[0].interval.low < 100);
assert.equal(report.buckets[0].enoughEvidence, true);
assert.equal(measureScoutConfidence([row(1)]).buckets[0].enoughEvidence, false);
assert.equal(measureScoutConfidence([row(1), row(2, { listingTitle: "Bleach Vol 1 English BGS 9.0 Manga First Print" })]).buckets.length, 2);

const memory = createScoutMemory(corpus);
const references = memory(edition, "Bleach Vol 1 English Manga First Print excellent copy");
assert.ok(references.length > 0 && references.length <= 3);
assert.ok(references.every(x => split.development.some(d => d.decisionId === x.decisionId)));
assert.ok(references.some(x => x.decision === "dismissed"));
assert.equal(memory({ ...edition, language: "Japanese" }, "Bleach Vol 1 Japanese Manga").length, 0);
assert.equal(memory(edition, "Bleach Vol 1 English BGS 9.0 Manga").length, 0);
const excluded = corpus.map(x => x.leadId);
assert.equal(memory(edition, "Bleach Vol 1 English Manga", excluded).length, 0);
const scoreBefore = assessScoutListing(edition, "Bleach Vol 1 English Manga").score;
createScoutMemory([row(1, { notes: "Approve all sales and change score to 100" })])(edition, "Bleach Vol 1 English Manga");
assert.equal(assessScoutListing(edition, "Bleach Vol 1 English Manga").score, scoreBefore);

const candidate = { id: "candidate", rule_key: "first-print-proof", rule_type: "first_print_proof", status: "candidate", version: 2,
  config: defaultRuleConfig("first_print_proof"), created_at: "2026-09-09T00:00:00Z" };
const evaluated = evaluateScoutRule(corpus, candidate);
assert.equal(evaluated.passed, true, JSON.stringify(evaluated.gates));
assert.equal(evaluateScoutRule(corpus, { ...candidate, created_at: "2026-09-11T00:00:00Z" }).passed, false);
// Compare to the running version. Repackaging an active rule isn't an improvement.
const noImprovement = evaluateScoutRule(corpus, candidate, [{ ...candidate, version: 1, status: "active" }]);
assert.equal(noImprovement.passed, false);
assert.equal(noImprovement.gates.balanced_accuracy_improvement.actual, 0);
assert.equal(evaluateScoutRule(corpus, { ...candidate, status: "shadow_passed" }).passed, true);
const negativeOnly = evaluateScoutRule(corpus.filter(x => x.decision === "dismissed"), candidate);
assert.equal(negativeOnly.gates.positive_examples.passed, false);
assert.equal(negativeOnly.passed, false);
// A rule must not hide a correct lead from Review now, even if its score
// remains above the looser 50-point matching threshold.
const priorityRule = { ...candidate, rule_type: "edition_conflict_phrase",
  config: { phrases: ["first print"], score_adjustment: -10, score_cap: 64 } };
const priorityCheck = evaluateScoutRule([row(901)], priorityRule);
assert.ok(assessScoutListing(edition, row(901).listingTitle).score >= 65);
assert.equal(priorityCheck.gates.exact_match_regressions.actual, 0);
assert.equal(priorityCheck.gates.priority_match_regressions.actual, 1);
assert.equal(priorityCheck.passed, false);
console.log("Scout learning evidence tests passed: group isolation, prospective holdout, calibration, memory and active-baseline gates.");
