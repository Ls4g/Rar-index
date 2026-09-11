import assert from "node:assert/strict";
import { evaluateReliabilityCase } from "../lib/agentReliability.ts";
import { isExecutableAgentAction, preflightAgentAction } from "../lib/agentActionExecution.ts";

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

const unsafePreflight = preflightAgentAction({
  id: "action-2", action_type: "scan_stale_profiles", status: "approved", target_type: "price_observations", target_id: null,
  evidence: {}, proposed_payload: {},
});
assert.equal(unsafePreflight.ok, false);
assert.ok(unsafePreflight.checks.filter((check) => !check.passed).length >= 3);

console.log("Agent Reliability tests passed (stored evidence, safety failures and typed execution preflight).\n");
