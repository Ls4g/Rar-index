import assert from "node:assert/strict";
import { analyseScoutFeedback } from "../lib/scoutFeedback.ts";

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

function decision(index, choice, listingTitle) {
  return {
    leadId: `lead-${index}`,
    decision: choice,
    reviewer: "SP",
    decidedAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    listingTitle,
    edition,
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

console.log("Scout feedback-loop tests passed (4 scenarios).\n");
