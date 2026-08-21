import assert from "node:assert/strict";
import { assessScoutListing } from "../lib/scoutIngest.ts";
import { evaluateScoutRule } from "../lib/scoutRuleEvaluation.ts";
import { applyScoutRules, defaultRuleConfig } from "../lib/scoutRules.ts";

function edition(series, volume = 1) {
  return {
    title: `${series}, Vol. ${volume}`,
    series,
    volume_number: String(volume),
    language: "English",
    isbn_13: null,
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
}

function rule(ruleType, config) {
  return { id: `${ruleType}-1`, rule_key: ruleType, version: 1, rule_type: ruleType, config, status: "candidate" };
}

const bleach = edition("Bleach");
const baseline = assessScoutListing(bleach, "Bleach Vol 1 Manga");
const firstPrintRule = rule("first_print_proof", defaultRuleConfig("first_print_proof"));
const adjusted = applyScoutRules(baseline, bleach, "Bleach Vol 1 Manga", [firstPrintRule]);
assert.equal(adjusted.score, Math.max(0, baseline.score - 25));
assert.equal(adjusted.appliedRules.length, 1);

const proven = applyScoutRules(assessScoutListing(bleach, "Bleach Vol 1 First Print Manga"), bleach, "Bleach Vol 1 First Print Manga", [firstPrintRule]);
assert.equal(proven.appliedRules.length, 0);

const hardConflict = assessScoutListing(bleach, "Bleach Vol 2 Manga");
const unchangedConflict = applyScoutRules(hardConflict, bleach, "Bleach Vol 2 Manga", [firstPrintRule]);
assert.equal(unchangedConflict.confidence, "conflict");
assert.equal(unchangedConflict.appliedRules.length, 0);

const phraseRule = rule("multi_volume_phrase", defaultRuleConfig("multi_volume_phrase", ["shelf clearance"]));
const phraseBase = assessScoutListing(bleach, "Bleach Vol 1 Manga shelf clearance");
const phraseAdjusted = applyScoutRules(phraseBase, bleach, "Bleach Vol 1 Manga shelf clearance", [phraseRule]);
assert.equal(phraseAdjusted.score, Math.min(49, Math.max(0, phraseBase.score - 40)));
assert.notEqual(phraseAdjusted.confidence, "conflict");

function decision(index, series, choice, label, title) {
  return {
    decisionId: `decision-${index}`,
    leadId: `lead-${index}`,
    decision: choice,
    reviewer: "SP",
    decidedAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    listingTitle: title,
    edition: edition(series),
    learningLabel: label,
  };
}

const insufficient = evaluateScoutRule([
  decision(0, "Bleach", "dismissed", "printing_unproven", "Bleach Vol 1 Manga"),
], firstPrintRule);
assert.equal(insufficient.passed, false);
assert.equal(insufficient.gates.sample_size.passed, false);

const series = ["Bleach", "Naruto", "One Piece", "Bleach", "Naruto"];
const passingDecisions = [
  ...series.map((name, index) => decision(index, name, "dismissed", "printing_unproven", `${name} Vol 1 Manga`)),
  ...series.map((name, index) => decision(index + 5, name, "watching", "exact_match", `${name} Vol 1 Manga First Print`)),
];
const passing = evaluateScoutRule(passingDecisions, firstPrintRule);
assert.equal(passing.passed, true);
assert.equal(passing.gates.exact_match_regressions.passed, true);
assert.equal(passing.gates.edition_coverage.passed, true);

console.log("Scout Phase 4 rule tests passed (score-only application, safety and promotion gates).\n");
