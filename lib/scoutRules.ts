import type { SupabaseClient } from "@supabase/supabase-js";
import { explicitPrintingNumber, type EditionMatchAssessment } from "./editionMatch.ts";
import type { ScoutEdition } from "./scoutIngest.ts";

export type ScoutRuleType = "first_print_proof" | "multi_volume_phrase" | "edition_conflict_phrase";

export type ScoutRule = {
  id: string;
  rule_key: string;
  version: number;
  rule_type: ScoutRuleType;
  config: {
    phrases?: string[];
    score_adjustment?: number;
    score_cap?: number;
  };
  status: string;
};

export type ScoutRuleApplication = EditionMatchAssessment & {
  appliedRules: Array<{ id: string; ruleKey: string; version: number; adjustment: number; scoreCap: number | null }>;
};

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ").trim();
}

function phraseMatches(title: string, phrase: string) {
  const haystack = ` ${normalized(title)} `;
  const needle = normalized(phrase);
  return Boolean(needle && haystack.includes(` ${needle} `));
}

function explicitlyClaimsFirstPrint(title: string) {
  return explicitPrintingNumber(title) === 1 || /\bfirst\s*edition\b/i.test(title);
}

function ruleApplies(rule: ScoutRule, edition: ScoutEdition, listingTitle: string) {
  if (rule.rule_type === "first_print_proof") {
    return Number(edition.printing_number) === 1 && !explicitlyClaimsFirstPrint(listingTitle);
  }
  const phrases = Array.isArray(rule.config.phrases) ? rule.config.phrases : [];
  return phrases.some((phrase) => phraseMatches(listingTitle, phrase));
}

function confidenceFor(score: number, hasConflict: boolean): EditionMatchAssessment["confidence"] {
  if (hasConflict) return "conflict";
  if (score >= 75) return "strong";
  if (score >= 50) return "partial";
  return "insufficient";
}

export function applyScoutRules(
  assessment: EditionMatchAssessment,
  edition: ScoutEdition,
  listingTitle: string,
  rules: ScoutRule[] = [],
): ScoutRuleApplication {
  let score = assessment.score;
  const reasons = [...assessment.reasons];
  const appliedRules: ScoutRuleApplication["appliedRules"] = [];

  // Existing deterministic conflicts remain authoritative. Learned rules are
  // a score-only layer and never turn a lead into an automatic dismissal.
  if (assessment.confidence !== "conflict") {
    for (const rule of rules) {
      if (rule.status !== "active" && rule.status !== "candidate") continue;
      if (!ruleApplies(rule, edition, listingTitle)) continue;
      const adjustment = Math.min(0, Number(rule.config.score_adjustment ?? 0));
      const configuredCap = rule.config.score_cap;
      const scoreCap = Number.isFinite(configuredCap) ? Number(configuredCap) : null;
      score = Math.max(0, score + adjustment);
      if (scoreCap !== null) score = Math.min(score, scoreCap);
      appliedRules.push({ id: rule.id, ruleKey: rule.rule_key, version: rule.version, adjustment, scoreCap });
      reasons.push(`RAR learned rule ${rule.rule_key} v${rule.version} adjusted this lead`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    confidence: confidenceFor(score, assessment.conflicts.length > 0),
    reasons,
    conflicts: [...assessment.conflicts],
    appliedRules,
  };
}

export async function loadActiveScoutRules(admin: SupabaseClient): Promise<ScoutRule[]> {
  const { data: regressionIncident, error: incidentError } = await admin
    .from("agent_incidents")
    .select("id")
    .eq("incident_key", "reliability:market_scout_match")
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (incidentError && incidentError.code !== "42P01" && incidentError.code !== "PGRST205") {
    throw new Error(`Scout could not check reliability incidents: ${incidentError.message}`);
  }
  // A learned rule is an optional score layer. If a later human benchmark
  // proves a safety regression, the stable deterministic scorer takes over
  // until staff resolve the incident. Nothing is silently rolled back.
  if (regressionIncident) return [];
  const { data, error } = await admin
    .from("scout_rule_versions")
    .select("id,rule_key,version,rule_type,config,status")
    .eq("status", "active")
    .order("rule_key");
  // Phase 4 deploys code before its additive migration is applied. Treat a
  // missing table as no learned rules, while surfacing every other DB error.
  if (error?.code === "42P01" || error?.code === "PGRST205") return [];
  if (error) throw new Error(`Scout could not load active learning rules: ${error.message}`);
  return (data ?? []) as ScoutRule[];
}

export function defaultRuleConfig(ruleType: ScoutRuleType, phrases: string[] = []) {
  const cleanedPhrases = [...new Set(phrases.map((phrase) => normalized(phrase)).filter(Boolean))].slice(0, 20);
  if (ruleType === "first_print_proof") return { score_adjustment: -25, score_cap: 74 };
  if (ruleType === "multi_volume_phrase") return { phrases: cleanedPhrases, score_adjustment: -40, score_cap: 49 };
  return { phrases: cleanedPhrases, score_adjustment: -30, score_cap: 49 };
}
