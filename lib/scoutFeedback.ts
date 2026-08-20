import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentProposal } from "./agentPlanning.ts";
import { learningLabelName, type ScoutLearningLabel } from "./scoutDecisionLabels.ts";
import { assessScoutListing, type ScoutEdition } from "./scoutIngest.ts";

const AUTOMATED_REVIEWERS = new Set([
  "RAR Market Scout",
  "RAR Auto-Triage",
  "RAR Market Scout system",
]);

export type HumanScoutDecision = {
  decisionId?: string;
  leadId: string;
  decision: "watching" | "dismissed";
  reviewer: string;
  decidedAt: string;
  listingTitle: string;
  edition: ScoutEdition;
  learningLabel?: ScoutLearningLabel | null;
};

export type ScoutFeedbackExample = {
  leadId: string;
  decision: "watching" | "dismissed";
  reviewer: string;
  listingTitle: string;
  editionLabel: string;
  score: number;
  confidence: string;
  conflicts: string[];
  learningLabel: ScoutLearningLabel | null;
  learningReason: string | null;
};

export type ScoutFeedbackAnalysis = {
  humanDecisions: number;
  watched: number;
  dismissed: number;
  aligned: number;
  labelledDecisions: number;
  labelCoveragePercent: number;
  labelCounts: Partial<Record<ScoutLearningLabel, number>>;
  watchedBelowReview: ScoutFeedbackExample[];
  watchedConflicts: ScoutFeedbackExample[];
  dismissedStillPlausible: ScoutFeedbackExample[];
  scorerRelevantDismissals: ScoutFeedbackExample[];
  proposals: AgentProposal[];
};

type DecisionRow = {
  id: string;
  lead_id: string;
  decision: string;
  reviewed_by: string;
  created_at: string;
  lead: {
    id: string;
    source_id: string;
    external_id: string;
    listing_title: string;
    profile: { edition: ScoutEdition | null } | null;
  } | null;
};

type LabelRow = {
  decision_id: string;
  label: ScoutLearningLabel;
};

const NON_SCORER_DISMISSALS = new Set<ScoutLearningLabel>([
  "graded_not_raw",
  "duplicate_listing",
  "unavailable",
  "poor_value",
]);

function editionLabel(edition: ScoutEdition) {
  return [edition.series ?? edition.title, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language]
    .filter(Boolean)
    .join(" · ");
}

function exampleFor(decision: HumanScoutDecision): ScoutFeedbackExample {
  const assessment = assessScoutListing(decision.edition, decision.listingTitle);
  return {
    leadId: decision.leadId,
    decision: decision.decision,
    reviewer: decision.reviewer,
    listingTitle: decision.listingTitle,
    editionLabel: editionLabel(decision.edition),
    score: assessment.score,
    confidence: assessment.confidence,
    conflicts: assessment.conflicts,
    learningLabel: decision.learningLabel ?? null,
    learningReason: learningLabelName(decision.learningLabel),
  };
}

function evidence(examples: ScoutFeedbackExample[], total: number) {
  const seriesCounts = new Map<string, number>();
  for (const item of examples) {
    const series = item.editionLabel.split(" · ")[0] || "Unknown edition";
    seriesCounts.set(series, (seriesCounts.get(series) ?? 0) + 1);
  }
  return {
    sample_size: total,
    examples: examples.slice(0, 8),
    most_affected_series: [...seriesCounts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([series, count]) => ({ series, count })),
    safety: "Investigation only. Approval does not change scoring, dismiss a lead, verify a sale, or alter a search profile.",
  };
}

function feedbackProposal(
  actionType: string,
  dedupeKey: string,
  title: string,
  rationale: string,
  examples: ScoutFeedbackExample[],
  confidence: number,
): AgentProposal {
  return {
    actionType,
    targetType: "scout_lead_decisions",
    dedupeKey,
    title,
    rationale,
    riskLevel: "low",
    confidence,
    evidence: evidence(examples, examples.length),
    proposedPayload: {
      operation: "investigate_feedback_pattern",
      automatic_rule_change: false,
      requires_human_approval: true,
    },
  };
}

function shadowProposal(
  actionType: string,
  dedupeKey: string,
  title: string,
  rationale: string,
  examples: ScoutFeedbackExample[],
  candidateRule: string,
): AgentProposal {
  return {
    actionType,
    targetType: "scout_lead_decisions",
    dedupeKey,
    title,
    rationale,
    riskLevel: "low",
    confidence: Math.min(0.95, 0.65 + examples.length / 100),
    evidence: evidence(examples, examples.length),
    proposedPayload: {
      operation: "run_shadow_evaluation",
      mode: "shadow_only",
      candidate_rule: candidateRule,
      automatic_rule_change: false,
      requires_human_approval: true,
      production_effect: "none",
    },
  };
}

export function analyseScoutFeedback(decisions: HumanScoutDecision[]): ScoutFeedbackAnalysis {
  const watchedBelowReview: ScoutFeedbackExample[] = [];
  const watchedConflicts: ScoutFeedbackExample[] = [];
  const dismissedStillPlausible: ScoutFeedbackExample[] = [];
  const scorerRelevantDismissals: ScoutFeedbackExample[] = [];
  const labelCounts: Partial<Record<ScoutLearningLabel, number>> = {};
  let watched = 0;
  let dismissed = 0;
  let aligned = 0;
  let labelledDecisions = 0;

  for (const decision of decisions) {
    const item = exampleFor(decision);
    if (item.learningLabel) {
      labelledDecisions += 1;
      labelCounts[item.learningLabel] = (labelCounts[item.learningLabel] ?? 0) + 1;
    }
    if (decision.decision === "watching") {
      watched += 1;
      if (item.confidence === "conflict") watchedConflicts.push(item);
      else if (item.score < 50) watchedBelowReview.push(item);
      else aligned += 1;
      continue;
    }

    dismissed += 1;
    if (item.confidence !== "conflict" && item.score >= 50) {
      dismissedStillPlausible.push(item);
      if (!item.learningLabel || !NON_SCORER_DISMISSALS.has(item.learningLabel)) scorerRelevantDismissals.push(item);
    }
    else aligned += 1;
  }

  const proposals: AgentProposal[] = [];
  if (watchedConflicts.length > 0) {
    proposals.push(feedbackProposal(
      "review_scout_feedback_conflicts",
      "scout:feedback:watched-conflicts:v1",
      `Investigate ${watchedConflicts.length} watched lead${watchedConflicts.length === 1 ? "" : "s"} now scored as conflicts`,
      "Staff chose to watch these listings, but the current deterministic scorer identifies an edition conflict. Check for a scorer regression before expanding auto-triage.",
      watchedConflicts,
      1,
    ));
  }
  if (watchedBelowReview.length >= 3) {
    proposals.push(feedbackProposal(
      "review_scout_feedback_recall",
      "scout:feedback:watched-below-review:v1",
      `Investigate ${watchedBelowReview.length} useful leads scored below the review threshold`,
      "Repeated staff Watch decisions suggest the scorer may be missing a positive edition signal. Inspect the examples before proposing a tested scoring change.",
      watchedBelowReview,
      Math.min(0.99, 0.75 + watchedBelowReview.length / 100),
    ));
  }
  if (scorerRelevantDismissals.length >= 5) {
    proposals.push(feedbackProposal(
      "review_scout_feedback_precision",
      "scout:feedback:dismissed-plausible:v1",
      `Investigate ${scorerRelevantDismissals.length} plausible leads staff dismissed`,
      "Repeated dismissals among leads scoring 50 or higher may reveal a missing negative edition signal or an over-broad search profile. Labels unrelated to edition matching are excluded from this pattern.",
      scorerRelevantDismissals,
      Math.min(0.99, 0.7 + scorerRelevantDismissals.length / 100),
    ));
  }

  const printingProofExamples = scorerRelevantDismissals.filter((item) => item.learningLabel === "printing_unproven");
  if (printingProofExamples.length >= 3) {
    proposals.push(shadowProposal(
      "shadow_test_first_print_proof_gate",
      "scout:shadow:first-print-proof:v1",
      `Shadow-test first-print proof against ${printingProofExamples.length} labelled decisions`,
      "Staff repeatedly dismissed otherwise plausible listings because first-print status was not proven. Measure a stricter proof gate against historical decisions before considering any production change.",
      printingProofExamples,
      "Require explicit first-print wording or stronger printing evidence before assigning a strong first-print match.",
    ));
  }

  const lotExamples = scorerRelevantDismissals.filter((item) => item.learningLabel === "multi_volume_lot");
  if (lotExamples.length >= 1) {
    proposals.push(shadowProposal(
      "shadow_test_multi_volume_detection",
      "scout:shadow:multi-volume:v1",
      `Shadow-test lot detection against ${lotExamples.length} labelled miss${lotExamples.length === 1 ? "" : "es"}`,
      "Staff identified multi-volume listings that the current score still considered plausible. Test broader lot wording against historical decisions without changing the live inbox.",
      lotExamples,
      "Detect additional multi-volume and set wording before a listing reaches the human review queue.",
    ));
  }

  const editionMismatchExamples = scorerRelevantDismissals.filter((item) => item.learningLabel === "edition_mismatch");
  if (editionMismatchExamples.length >= 5) {
    proposals.push(shadowProposal(
      "shadow_test_edition_conflicts",
      "scout:shadow:edition-conflicts:v1",
      `Research missing edition conflicts in ${editionMismatchExamples.length} labelled decisions`,
      "These high-scoring listings were dismissed as the wrong edition. Compare their titles and profile boundaries to find a deterministic conflict that can be tested safely.",
      editionMismatchExamples,
      "Evaluate a candidate edition-conflict signal against labelled history before changing production scoring.",
    ));
  }

  return {
    humanDecisions: decisions.length,
    watched,
    dismissed,
    aligned,
    labelledDecisions,
    labelCoveragePercent: decisions.length ? Math.round((labelledDecisions / decisions.length) * 100) : 0,
    labelCounts,
    watchedBelowReview,
    watchedConflicts,
    dismissedStillPlausible,
    scorerRelevantDismissals,
    proposals,
  };
}

export async function readHumanScoutDecisions(admin: SupabaseClient): Promise<HumanScoutDecision[]> {
  const rows: DecisionRow[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 10_000; from += pageSize) {
    const { data, error } = await admin
      .from("scout_lead_decisions")
      .select("id,lead_id,decision,reviewed_by,created_at,lead:scout_listing_leads!inner(id,source_id,external_id,listing_title,profile:marketplace_search_profiles!inner(edition:manga_editions!inner(id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no)))")
      .order("created_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Market Scout could not read staff feedback: ${error.message}`);
    const page = (data ?? []) as unknown as DecisionRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }

  const latestHumanByLead = new Map<string, DecisionRow>();
  for (const row of rows) {
    if (latestHumanByLead.has(row.lead_id) || AUTOMATED_REVIEWERS.has(row.reviewed_by) || row.reviewed_by.endsWith(" system")) continue;
    if (!row.lead?.profile?.edition || !["watching", "dismissed"].includes(row.decision)) continue;
    latestHumanByLead.set(row.lead_id, row);
  }

  const latestByListingAndEdition = new Map<string, DecisionRow>();
  for (const row of latestHumanByLead.values()) {
    const editionId = (row.lead?.profile?.edition as (ScoutEdition & { id?: string }) | null)?.id;
    const listingKey = [row.lead?.source_id, row.lead?.external_id, editionId].join(":");
    if (!latestByListingAndEdition.has(listingKey)) latestByListingAndEdition.set(listingKey, row);
  }

  const selectedRows = [...latestByListingAndEdition.values()];
  const labelByDecision = new Map<string, ScoutLearningLabel>();
  const decisionIds = selectedRows.map((row) => row.id);
  for (let index = 0; index < decisionIds.length; index += 200) {
    const { data, error } = await admin
      .from("scout_decision_labels")
      .select("decision_id,label")
      .in("decision_id", decisionIds.slice(index, index + 200));
    if (error) throw new Error(`Market Scout could not read staff learning labels: ${error.message}`);
    for (const row of (data ?? []) as LabelRow[]) labelByDecision.set(row.decision_id, row.label);
  }

  return selectedRows.map((row) => ({
    decisionId: row.id,
    leadId: row.lead_id,
    decision: row.decision as "watching" | "dismissed",
    reviewer: row.reviewed_by,
    decidedAt: row.created_at,
    listingTitle: row.lead?.listing_title ?? "",
    edition: row.lead?.profile?.edition as ScoutEdition,
    learningLabel: labelByDecision.get(row.id) ?? null,
  }));
}

export async function analyseLiveScoutFeedback(admin: SupabaseClient) {
  return analyseScoutFeedback(await readHumanScoutDecisions(admin));
}
