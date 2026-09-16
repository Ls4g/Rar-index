import assert from "node:assert/strict";
import { evaluateReliabilityCase, raisesIncident, UNSUPERVISED_EVALUATORS, RELIABILITY_EVALUATORS } from "../lib/agentReliability.ts";
import { isExecutableAgentAction, preflightAgentAction } from "../lib/agentActionExecution.ts";
import { ruleCandidateForAction } from "../lib/scoutRuleEvaluation.ts";

function benchmark(evaluator_key, expected_outcome, input_snapshot) {
  return {
    id: `case-${evaluator_key}-${expected_outcome}`,
    agent_key: evaluator_key.startsWith("market") ? "market_scout" : evaluator_key.startsWith("evidence") ? "evidence_auditor" : "catalogue_curator",
    evaluator_key,
    subject_key: `subject:${evaluator_key}`,
    input_snapshot,
    expected_outcome,
    reason_label: null,
    reviewed_by: "SP",
    decided_at: "2026-09-02T10:00:00Z",
    created_at: "2026-09-02T10:00:00Z",
  };
}

const edition = { title: "Naruto, Vol. 1", series: "Naruto", volume_number: "1", language: "English", isbn_13: null, publisher: "VIZ Media", format: "Paperback", printing_number: 1 };
const usefulScout = evaluateReliabilityCase(benchmark("market_scout_match", "useful", { listingTitle: "Naruto Vol 1 Manga English", edition }));
assert.equal(usefulScout.predictedOutcome, "useful");
assert.equal(usefulScout.criticalFailure, false);
const confirmedMatch = { ...benchmark("market_scout_match", "useful", { listingTitle: "Naruto Vol 1 Manga English", edition }), reason_label: "exact_match" };
const harmfulRule = { id: "test-rule", rule_key: "test", version: 1, status: "active", rule_type: "first_print_proof", config: { score_adjustment: -40, score_cap: 49 } };
const activeRuleRegression = evaluateReliabilityCase(confirmedMatch, [harmfulRule]);
assert.equal(activeRuleRegression.predictedOutcome, "dismiss");
assert.equal(activeRuleRegression.criticalFailure, true);

const wrongVolume = evaluateReliabilityCase(benchmark("market_scout_match", "dismiss", { listingTitle: "Naruto Vol 8 Manga English", edition }));
assert.equal(wrongVolume.predictedOutcome, "dismiss");

const safeSale = evaluateReliabilityCase(benchmark("evidence_sale_guard", "eligible", { observation: {
  sale_status: "confirmed", source_listing_url: "https://www.ebay.com/itm/123", price: 25, currency: "USD", sold_date: "2026-08-31", edition_id: "edition-1",
} }));
assert.equal(safeSale.predictedOutcome, "eligible");

const activeListing = evaluateReliabilityCase(benchmark("evidence_sale_guard", "reject", { observation: {
  sale_status: "active", source_listing_url: "https://www.ebay.com/itm/456", price: 25, currency: "USD", sold_date: null, edition_id: "edition-1",
} }));
assert.equal(activeListing.predictedOutcome, "reject");

const sourcedCover = evaluateReliabilityCase(benchmark("cover_provenance_guard", "publishable", {
  imageUrl: "https://covers.example/naruto.jpg", sourceUrl: "https://publisher.example/naruto-1", sourceName: "Publisher",
}));
assert.equal(sourcedCover.predictedOutcome, "publishable");

const scanPreflight = preflightAgentAction({
  id: "action-1", action_type: "scan_stale_profiles", status: "proposed", target_type: "marketplace_search_profiles", target_id: null,
  evidence: { stale_search_profiles: 10 }, proposed_payload: {},
});
assert.equal(scanPreflight.ok, true);
assert.equal(isExecutableAgentAction("shadow_test_edition_conflicts"), true);
assert.equal(isExecutableAgentAction("review_scout_feedback_conflicts"), false);
const derivedEditionRule = ruleCandidateForAction("shadow_test_edition_conflicts", [], { examples: [
  { listingTitle: "Berserk Deluxe Edition Volume 7" },
  { listingTitle: "Initial D Omnibus Vol 1" },
] });
assert.deepEqual(derivedEditionRule?.config.phrases, ["deluxe edition", "omnibus"]);

// A scan pointed at the wrong table, carrying no evidence. Both are named
// individually so a future change cannot quietly drop one and still pass on a
// count.
const unsafePreflight = preflightAgentAction({
  id: "action-2", action_type: "scan_stale_profiles", status: "approved", target_type: "price_observations", target_id: null,
  evidence: {}, proposed_payload: {},
});
assert.equal(unsafePreflight.ok, false);
const failedKeys = unsafePreflight.checks.filter((check) => !check.passed).map((check) => check.key).sort();
assert.deepEqual(failedKeys, ["evidence_present", "scan_scope"]);
// Approved is executable. Approving a machine-executable action without
// running it used to lock it out of ever running -- six actions were stuck
// exactly that way -- so this check must NOT fail on an approved action.
assert.equal(unsafePreflight.checks.find((check) => check.key === "open_for_execution")?.passed, true);

// But a decision that closed the action still refuses execution.
for (const status of ["rejected", "cancelled", "executed"]) {
  const closed = preflightAgentAction({
    id: "action-3", action_type: "scan_stale_profiles", status, target_type: "marketplace_search_profiles", target_id: null,
    evidence: { profiles: 4 }, proposed_payload: {},
  });
  assert.equal(closed.ok, false, `${status} must not be executable`);
  assert.equal(closed.checks.find((check) => check.key === "open_for_execution")?.passed, false);
}

// --- Which evaluators may raise an incident -------------------------------
// An incident is for automation acting unattended. Scout auto-dismisses, so a
// genuine lead it bins is lost with nobody watching. Every other evaluator is
// a completeness check feeding a human queue: a critical failure there means a
// person was shown a well-formed record and rejected it, which is the system
// working. Raising that daily produced 14 incidents, resolved 11 times, each
// returning with an identical count.
assert.equal(raisesIncident("market_scout_match"), true, "Scout auto-dismissal must still raise an incident");
for (const key of ["catalogue_curator_guard", "evidence_sale_guard", "evidence_print_guard", "cover_provenance_guard"]) {
  assert.equal(raisesIncident(key), false, key + " must not raise a daily incident for human disagreement");
}
// The split must stay exhaustive: a new evaluator has to be classified, not
// silently inherit whichever behaviour happens to be the default.
for (const key of RELIABILITY_EVALUATORS) {
  assert.equal(typeof raisesIncident(key), "boolean", key + " must have an explicit classification");
}
assert.equal(UNSUPERVISED_EVALUATORS.size, 1, "only Scout acts without a person; adding to this set means adding an alarm");
assert.ok(UNSUPERVISED_EVALUATORS.has("market_scout_match"));

// The evaluator that lost real opportunities still reports them as critical,
// so silencing the noise must not silence the one that matters.
const stillCritical = evaluateReliabilityCase(confirmedMatch, [harmfulRule]);
assert.equal(stillCritical.criticalFailure, true, "a dismissed exact match is still a critical failure");
assert.equal(raisesIncident("market_scout_match"), true);

// A human rejecting a complete record stays a recorded disagreement -- the
// case-level flag is unchanged, only what it triggers has changed.
const completeButRejected = evaluateReliabilityCase(benchmark("evidence_sale_guard", "reject", { observation: {
  sale_status: "confirmed", source_listing_url: "https://www.ebay.co.uk/itm/1", sale_price: 12, currency: "GBP", sold_date: "2026-08-01", edition_id: "edition-1",
} }));
assert.equal(completeButRejected.predictedOutcome, "eligible");
assert.equal(completeButRejected.criticalFailure, true, "the disagreement is still recorded at case level");
assert.equal(raisesIncident("evidence_sale_guard"), false, "but it must not raise an incident");

console.log("Agent Reliability tests passed (stored evidence, safety failures and typed execution preflight).\n");
