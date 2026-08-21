import type { SupabaseClient } from "@supabase/supabase-js";
import { assessScoutListing } from "./scoutIngest.ts";
import { readHumanScoutDecisions, type HumanScoutDecision } from "./scoutFeedback.ts";
import { applyScoutRules, defaultRuleConfig, type ScoutRule, type ScoutRuleType } from "./scoutRules.ts";

const ACTION_RULE_TYPES: Record<string, { key: string; type: ScoutRuleType }> = {
  shadow_test_first_print_proof_gate: { key: "first-print-proof", type: "first_print_proof" },
  shadow_test_multi_volume_detection: { key: "multi-volume-language", type: "multi_volume_phrase" },
  shadow_test_edition_conflicts: { key: "edition-conflict-language", type: "edition_conflict_phrase" },
};

const DEFAULT_LOT_PHRASES = ["bundle", "collection", "complete set", "manga set", "volume set", "volumes", "vols", "lot"];

type EvaluationExample = {
  leadId: string;
  label: string;
  listingTitle: string;
  edition: string;
  baselineScore: number;
  candidateScore: number;
};

function labelSet(ruleType: ScoutRuleType) {
  if (ruleType === "first_print_proof") return { positive: "exact_match", negative: "printing_unproven" };
  if (ruleType === "multi_volume_phrase") return { positive: "exact_match", negative: "multi_volume_lot" };
  return { positive: "exact_match", negative: "edition_mismatch" };
}

function editionKey(item: HumanScoutDecision) {
  return [item.edition.series ?? item.edition.title, item.edition.volume_number, item.edition.language].join("|");
}

function accuracy(rows: Array<{ expectedPositive: boolean; predictedPositive: boolean }>) {
  if (!rows.length) return 0;
  return rows.filter((row) => row.expectedPositive === row.predictedPositive).length / rows.length;
}

function balancedAccuracy(rows: Array<{ expectedPositive: boolean; predictedPositive: boolean }>) {
  const positives = rows.filter((row) => row.expectedPositive);
  const negatives = rows.filter((row) => !row.expectedPositive);
  const sensitivity = positives.length ? positives.filter((row) => row.predictedPositive).length / positives.length : 0;
  const specificity = negatives.length ? negatives.filter((row) => !row.predictedPositive).length / negatives.length : 0;
  return (sensitivity + specificity) / 2;
}

export function evaluateScoutRule(decisions: HumanScoutDecision[], rule: ScoutRule) {
  const labels = labelSet(rule.rule_type);
  const relevant = decisions.filter((item) => {
    if (item.learningLabel !== labels.positive && item.learningLabel !== labels.negative) return false;
    return rule.rule_type !== "first_print_proof" || Number(item.edition.printing_number) === 1;
  });
  const negatives = relevant.filter((item) => item.learningLabel === labels.negative);
  const examples: EvaluationExample[] = [];
  const baselineRows: Array<{ expectedPositive: boolean; predictedPositive: boolean }> = [];
  const candidateRows: Array<{ expectedPositive: boolean; predictedPositive: boolean }> = [];
  let negativesLowered = 0;
  let exactMatchRegressions = 0;

  for (const item of relevant) {
    const baseline = assessScoutListing(item.edition, item.listingTitle);
    const candidate = applyScoutRules(baseline, item.edition, item.listingTitle, [rule]);
    const expectedPositive = item.learningLabel === labels.positive;
    baselineRows.push({ expectedPositive, predictedPositive: baseline.score >= 50 });
    candidateRows.push({ expectedPositive, predictedPositive: candidate.score >= 50 });
    if (!expectedPositive && candidate.score < baseline.score) negativesLowered += 1;
    if (expectedPositive && baseline.score >= 50 && candidate.score < 50) exactMatchRegressions += 1;
    if (candidate.score !== baseline.score || examples.length < 12) {
      examples.push({
        leadId: item.leadId,
        label: item.learningLabel ?? "unlabelled",
        listingTitle: item.listingTitle,
        edition: editionKey(item),
        baselineScore: baseline.score,
        candidateScore: candidate.score,
      });
    }
  }

  const baselineBalanced = balancedAccuracy(baselineRows);
  const candidateBalanced = balancedAccuracy(candidateRows);
  const distinctEditions = new Set(relevant.map(editionKey)).size;
  const loweredRate = negatives.length ? negativesLowered / negatives.length : 0;
  const gates = {
    sample_size: { passed: relevant.length >= 10, actual: relevant.length, required: 10 },
    negative_examples: { passed: negatives.length >= 5, actual: negatives.length, required: 5 },
    edition_coverage: { passed: distinctEditions >= 3, actual: distinctEditions, required: 3 },
    target_coverage: { passed: loweredRate >= 0.8, actual: loweredRate, required: 0.8 },
    balanced_accuracy_improvement: { passed: candidateBalanced - baselineBalanced >= 0.1, actual: candidateBalanced - baselineBalanced, required: 0.1 },
    exact_match_regressions: { passed: exactMatchRegressions === 0, actual: exactMatchRegressions, required: 0 },
  };
  const passed = Object.values(gates).every((gate) => gate.passed);

  return {
    passed,
    baselineMetrics: { accuracy: accuracy(baselineRows), balanced_accuracy: baselineBalanced, review_positive: baselineRows.filter((row) => row.predictedPositive).length },
    candidateMetrics: { accuracy: accuracy(candidateRows), balanced_accuracy: candidateBalanced, review_positive: candidateRows.filter((row) => row.predictedPositive).length, negatives_lowered: negativesLowered },
    gates,
    examples: examples.slice(0, 20),
  };
}

export function ruleCandidateForAction(actionType: string, phrases: string[] = []) {
  const definition = ACTION_RULE_TYPES[actionType];
  if (!definition) return null;
  const configuredPhrases = definition.type === "multi_volume_phrase"
    ? [...DEFAULT_LOT_PHRASES, ...phrases]
    : phrases;
  if (definition.type === "edition_conflict_phrase" && !configuredPhrases.length) {
    throw new Error("Enter at least one exact conflict phrase before testing this rule.");
  }
  return { ...definition, config: defaultRuleConfig(definition.type, configuredPhrases) };
}

export async function createAndEvaluateScoutRule(
  admin: SupabaseClient,
  action: { id: string; action_type: string },
  reviewer: string,
  phrases: string[] = [],
) {
  const definition = ruleCandidateForAction(action.action_type, phrases);
  if (!definition) throw new Error("This recommendation does not define a Scout scoring rule.");

  const { data: existing } = await admin
    .from("scout_rule_versions")
    .select("id,rule_key,version,rule_type,config,status,evaluation_metrics")
    .eq("source_action_id", action.id)
    .maybeSingle();
  if (existing) return existing;

  const { data: latest, error: versionError } = await admin
    .from("scout_rule_versions")
    .select("version")
    .eq("rule_key", definition.key)
    .order("version", { ascending: false })
    .limit(1);
  if (versionError) throw new Error(`Scout could not prepare the rule version: ${versionError.message}`);
  const version = Number(latest?.[0]?.version ?? 0) + 1;
  const { data: inserted, error: insertError } = await admin.from("scout_rule_versions").insert({
    rule_key: definition.key,
    version,
    rule_type: definition.type,
    config: definition.config,
    status: "candidate",
    source_action_id: action.id,
    created_by: reviewer,
  }).select("id,rule_key,version,rule_type,config,status").single();
  if (insertError || !inserted) throw new Error(`Scout could not create the candidate rule: ${insertError?.message ?? "unknown error"}`);

  const decisions = await readHumanScoutDecisions(admin);
  const evaluation = evaluateScoutRule(decisions, inserted as ScoutRule);
  const { error: evaluationError } = await admin.from("scout_rule_evaluations").insert({
    rule_version_id: inserted.id,
    baseline_metrics: evaluation.baselineMetrics,
    candidate_metrics: evaluation.candidateMetrics,
    gates: evaluation.gates,
    examples: evaluation.examples,
    passed: evaluation.passed,
    evaluated_by: reviewer,
  });
  if (evaluationError) throw new Error(`Scout could not save the shadow evaluation: ${evaluationError.message}`);

  const nextStatus = evaluation.passed ? "shadow_passed" : "candidate";
  const { data: updated, error: updateError } = await admin.from("scout_rule_versions").update({
    status: nextStatus,
    evaluation_metrics: { baseline: evaluation.baselineMetrics, candidate: evaluation.candidateMetrics, gates: evaluation.gates, passed: evaluation.passed },
    tested_at: new Date().toISOString(),
    approved_by: reviewer,
  }).eq("id", inserted.id).select("id,rule_key,version,rule_type,config,status,evaluation_metrics").single();
  if (updateError) throw new Error(`Scout could not finish the shadow evaluation: ${updateError.message}`);
  return updated;
}

export async function reevaluateScoutRule(admin: SupabaseClient, ruleVersionId: string, reviewer: string) {
  const { data: rule, error: ruleError } = await admin
    .from("scout_rule_versions")
    .select("id,rule_key,version,rule_type,config,status")
    .eq("id", ruleVersionId)
    .in("status", ["candidate", "shadow_passed"])
    .maybeSingle();
  if (ruleError || !rule) throw new Error(ruleError?.message ?? "Only a candidate rule can be evaluated again.");
  const decisions = await readHumanScoutDecisions(admin);
  const evaluation = evaluateScoutRule(decisions, rule as ScoutRule);
  const { error: evaluationError } = await admin.from("scout_rule_evaluations").insert({
    rule_version_id: rule.id,
    baseline_metrics: evaluation.baselineMetrics,
    candidate_metrics: evaluation.candidateMetrics,
    gates: evaluation.gates,
    examples: evaluation.examples,
    passed: evaluation.passed,
    evaluated_by: reviewer,
  });
  if (evaluationError) throw new Error(`Scout could not save the shadow evaluation: ${evaluationError.message}`);
  const status = evaluation.passed ? "shadow_passed" : "candidate";
  const { data: updated, error: updateError } = await admin.from("scout_rule_versions").update({
    status,
    evaluation_metrics: { baseline: evaluation.baselineMetrics, candidate: evaluation.candidateMetrics, gates: evaluation.gates, passed: evaluation.passed },
    tested_at: new Date().toISOString(),
    approved_by: reviewer,
  }).eq("id", rule.id).select("id,rule_key,version,rule_type,config,status,evaluation_metrics").single();
  if (updateError) throw new Error(`Scout could not update the shadow result: ${updateError.message}`);
  return updated;
}

export async function readScoutRuleDashboard(admin: SupabaseClient) {
  const [{ data: rules, error: ruleError }, { data: evaluations, error: evaluationError }] = await Promise.all([
    admin.from("scout_rule_versions").select("id,rule_key,version,rule_type,config,status,evaluation_metrics,created_by,approved_by,created_at,tested_at,activated_at,superseded_at").order("created_at", { ascending: false }).limit(50),
    admin.from("scout_rule_evaluations").select("id,rule_version_id,baseline_metrics,candidate_metrics,gates,examples,passed,evaluated_by,evaluated_at").order("evaluated_at", { ascending: false }).limit(50),
  ]);
  if (ruleError?.code === "42P01" || ruleError?.code === "PGRST205") return { rules: [], evaluations: [], ready: false };
  if (ruleError || evaluationError) throw new Error(ruleError?.message ?? evaluationError?.message ?? "Rule dashboard could not load.");
  return { rules: rules ?? [], evaluations: evaluations ?? [], ready: true };
}
