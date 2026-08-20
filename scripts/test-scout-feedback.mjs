import assert from "node:assert/strict";
import { analyseScoutFeedback } from "../lib/scoutFeedback.ts";
import { learningLabelFitsDecision } from "../lib/scoutDecisionLabels.ts";

const edition = {
  title: "Bleach, Vol. 1",
  series: "Bleach",
  volume_number: "1",
  language: "English",
  isbn_13: "9781591164418",
  publisher: "VIZ Media",
  format: "Paperback",
  printing_number: 1,
  edition_statement: "First printing",
  variant_name: null,
  collectible_type: "tankobon",
  issue_year: null,
  issue_number_label: null,
  cumulative_issue_no: null,
};

function decision(index, choice, listingTitle, learningLabel = null) {
  return {
    leadId: `lead-${index}`,
    decision: choice,
    reviewer: "SP",
    decidedAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    listingTitle,
    edition,
    learningLabel,
  };
}

const aligned = analyseScoutFeedback([
  decision(0, "watching", "Bleach Vol 1 Manga English VIZ First Print"),
  decision(1, "dismissed", "Bleach Vol 8 Manga English VIZ"),
]);
assert.equal(aligned.aligned, 2);
assert.equal(aligned.proposals.length, 0);

const recallGap = analyseScoutFeedback([
  decision(0, "watching", "Rare manga book"),
  decision(1, "watching", "Old collectible comic"),
  decision(2, "watching", "Unknown old comic"),
]);
assert.equal(recallGap.watchedBelowReview.length, 3);
assert.deepEqual(recallGap.proposals.map((item) => item.actionType), ["review_scout_feedback_recall"]);

const precisionGap = analyseScoutFeedback(Array.from({ length: 5 }, (_, index) =>
  decision(index, "dismissed", "Bleach Vol 1 Manga English VIZ First Print"),
));
assert.equal(precisionGap.dismissedStillPlausible.length, 5);
assert.deepEqual(precisionGap.proposals.map((item) => item.actionType), ["review_scout_feedback_precision"]);

const conflictGap = analyseScoutFeedback([
  decision(0, "watching", "Bleach Vol 8 Manga English VIZ"),
]);
assert.equal(conflictGap.watchedConflicts.length, 1);
assert.deepEqual(conflictGap.proposals.map((item) => item.actionType), ["review_scout_feedback_conflicts"]);
assert.equal(conflictGap.proposals[0].proposedPayload?.automatic_rule_change, false);

const nonScorerDismissals = analyseScoutFeedback([
  decision(0, "dismissed", "Bleach Vol 1 Manga English VIZ First Print", "poor_value"),
  decision(1, "dismissed", "Bleach Vol 1 Manga English VIZ First Print", "unavailable"),
  decision(2, "dismissed", "Bleach Vol 1 Manga English VIZ First Print", "duplicate_listing"),
  decision(3, "dismissed", "Bleach Vol 1 Manga English VIZ First Print", "graded_not_raw"),
  decision(4, "dismissed", "Bleach Vol 1 Manga English VIZ First Print", "poor_value"),
]);
assert.equal(nonScorerDismissals.dismissedStillPlausible.length, 5);
assert.equal(nonScorerDismissals.scorerRelevantDismissals.length, 0);
assert.equal(nonScorerDismissals.proposals.length, 0);

const printingShadow = analyseScoutFeedback([
  decision(0, "dismissed", "Bleach Vol 1 Manga English VIZ", "printing_unproven"),
  decision(1, "dismissed", "Bleach Volume 1 Manga VIZ English", "printing_unproven"),
  decision(2, "dismissed", "Bleach Vol. 1 English Manga VIZ", "printing_unproven"),
]);
assert.equal(printingShadow.labelledDecisions, 3);
assert.equal(printingShadow.labelCoveragePercent, 100);
assert.equal(printingShadow.proposals.at(-1)?.actionType, "shadow_test_first_print_proof_gate");
assert.equal(printingShadow.proposals.at(-1)?.proposedPayload?.mode, "shadow_only");
assert.equal(printingShadow.proposals.at(-1)?.proposedPayload?.automatic_rule_change, false);

const lotShadow = analyseScoutFeedback([
  decision(0, "dismissed", "Bleach Vol 1 Manga English VIZ bundle", "multi_volume_lot"),
]);
assert.equal(lotShadow.proposals.at(-1)?.actionType, "shadow_test_multi_volume_detection");

assert.equal(learningLabelFitsDecision("", "watching"), true);
assert.equal(learningLabelFitsDecision("", "dismissed"), true);
assert.equal(learningLabelFitsDecision("exact_match", "watching"), true);
assert.equal(learningLabelFitsDecision("exact_match", "dismissed"), false);
assert.equal(learningLabelFitsDecision("printing_unproven", "dismissed"), true);
assert.equal(learningLabelFitsDecision("printing_unproven", "watching"), false);

console.log("Scout feedback-loop tests passed (7 scenarios plus decision-label validation).\n");
