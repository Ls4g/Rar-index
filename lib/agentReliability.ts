import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decideScoutAutoDismiss } from "./scoutAutoTriage.ts";
import { assessScoutListing, type ScoutEdition } from "./scoutIngest.ts";
import { assessPrintingEvidenceSuggestion } from "./printingEvidenceSuggestions.ts";
import { readHumanScoutDecisions } from "./scoutFeedback.ts";
import type { AgentKey } from "./agentPlanning.ts";

export const RELIABILITY_EVALUATORS = [
  "market_scout_match",
  "catalogue_curator_guard",
  "evidence_sale_guard",
  "evidence_print_guard",
  "cover_provenance_guard",
] as const;

export type ReliabilityEvaluatorKey = (typeof RELIABILITY_EVALUATORS)[number];

const EVALUATOR_VERSION = 1;
const AUTOMATED_REVIEWER = /(?:agent|scout|curator|auditor|operator|system|auto.?triage)/i;

type Json = Record<string, unknown>;
export type BenchmarkCase = {
  id: string;
  agent_key: AgentKey;
  evaluator_key: ReliabilityEvaluatorKey;
  subject_key: string;
  input_snapshot: Json;
  expected_outcome: string;
  reason_label: string | null;
  reviewed_by: string;
  decided_at: string;
  created_at: string;
};

type CandidateCase = Omit<BenchmarkCase, "id" | "created_at"> & {
  source_decision_table: string;
  source_decision_id: string;
};

export type ReliabilityCaseResult = {
  benchmarkCaseId: string;
  expectedOutcome: string;
  predictedOutcome: string;
  score: number | null;
  passed: boolean;
  criticalFailure: boolean;
  diagnostics: Json;
};

export type ReliabilityRunSummary = {
  id: string;
  evaluatorKey: ReliabilityEvaluatorKey;
  agentKey: AgentKey;
  passed: boolean;
  caseCount: number;
  positiveCount: number;
  negativeCount: number;
  distinctSubjects: number;
  regressionCount: number;
  metrics: Json;
  gates: Record<string, { passed: boolean; actual: number; required: number }>;
  createdAt: string;
};

function isHuman(value: unknown) {
  return typeof value === "string" && Boolean(value.trim()) && !AUTOMATED_REVIEWER.test(value);
}

function asObject(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function validHttpUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function hashSnapshot(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function readAll<T>(queryForRange: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const rows: T[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 20_000; from += pageSize) {
    const { data, error } = await queryForRange(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function latestBySubject(cases: BenchmarkCase[]) {
  const latest = new Map<string, BenchmarkCase>();
  for (const item of cases.sort((a, b) => {
    const decided = Date.parse(b.decided_at) - Date.parse(a.decided_at);
    return decided || Date.parse(b.created_at) - Date.parse(a.created_at);
  })) {
    if (!latest.has(item.subject_key)) latest.set(item.subject_key, item);
  }
  return [...latest.values()];
}

async function catalogueCases(admin: SupabaseClient): Promise<CandidateCase[]> {
  type Row = {
    id: string; catalogue_import_id: string; decision: string; decision_notes: string | null;
    reviewed_by: string; created_at: string; resulting_edition_id: string | null;
    item: Json | null;
  };
  const rows = await readAll<Row>((from, to) => admin.from("catalogue_review_decisions")
    .select("id,catalogue_import_id,decision,decision_notes,reviewed_by,created_at,resulting_edition_id,item:catalogue_import_queue(*)")
    .order("created_at", { ascending: false }).range(from, to));
  return rows.filter((row) => isHuman(row.reviewed_by) && ["approve_new", "link_existing", "rejected", "duplicate"].includes(row.decision) && row.item)
    .map((row) => ({
      agent_key: "catalogue_curator",
      evaluator_key: "catalogue_curator_guard",
      subject_key: `catalogue:${row.catalogue_import_id}`,
      source_decision_table: "catalogue_review_decisions",
      source_decision_id: row.id,
      input_snapshot: { queue: row.item, decisionNotes: row.decision_notes },
      expected_outcome: ["approve_new", "link_existing"].includes(row.decision) ? "publishable" : "reject",
      reason_label: row.decision,
      reviewed_by: row.reviewed_by,
      decided_at: row.created_at,
    }));
}

async function saleCases(admin: SupabaseClient): Promise<CandidateCase[]> {
  type Row = {
    id: string; observation_id: string; decision: string; decision_notes: string | null;
    reviewed_by: string; created_at: string; observation: Json | null;
  };
  const rows = await readAll<Row>((from, to) => admin.from("price_review_decisions")
    .select("id,observation_id,decision,decision_notes,reviewed_by,created_at,observation:price_observations(*)")
    .order("created_at", { ascending: false }).range(from, to));
  return rows.filter((row) => isHuman(row.reviewed_by) && ["verified_match", "excluded"].includes(row.decision) && row.observation)
    .map((row) => ({
      agent_key: "evidence_auditor",
      evaluator_key: "evidence_sale_guard",
      subject_key: `sale:${row.observation_id}`,
      source_decision_table: "price_review_decisions",
      source_decision_id: row.id,
      input_snapshot: { observation: row.observation, decisionNotes: row.decision_notes },
      expected_outcome: row.decision === "verified_match" ? "eligible" : "reject",
      reason_label: row.decision,
      reviewed_by: row.reviewed_by,
      decided_at: row.created_at,
    }));
}

async function printCases(admin: SupabaseClient): Promise<CandidateCase[]> {
  type Row = {
    id: string; observation_id: string; classification: string; decision_notes: string | null;
    reviewed_by: string; created_at: string; printing_proof_url: string | null; known_printing_number: number | null;
    observation: Json | null;
  };
  const rows = await readAll<Row>((from, to) => admin.from("price_print_classification_decisions")
    .select("id,observation_id,classification,decision_notes,reviewed_by,created_at,printing_proof_url,known_printing_number,observation:price_observations(*)")
    .order("created_at", { ascending: false }).range(from, to));
  return rows.filter((row) => isHuman(row.reviewed_by) && row.observation)
    .map((row) => ({
      agent_key: "evidence_auditor",
      evaluator_key: "evidence_print_guard",
      subject_key: `printing:${row.observation_id}`,
      source_decision_table: "price_print_classification_decisions",
      source_decision_id: row.id,
      input_snapshot: {
        observation: row.observation,
        classification: row.classification,
        printingProofUrl: row.printing_proof_url,
        knownPrintingNumber: row.known_printing_number,
        decisionNotes: row.decision_notes,
      },
      expected_outcome: row.classification === "printing_not_identified" ? "unproven" : "classifiable",
      reason_label: row.classification,
      reviewed_by: row.reviewed_by,
      decided_at: row.created_at,
    }));
}

async function coverCases(admin: SupabaseClient): Promise<CandidateCase[]> {
  type Row = {
    id: string; edition_id: string; decision: string; cover_image_url: string | null;
    cover_source_url: string | null; cover_source_name: string | null; decision_notes: string | null;
    reviewed_by: string; created_at: string;
  };
  const rows = await readAll<Row>((from, to) => admin.from("cover_review_decisions")
    .select("id,edition_id,decision,cover_image_url,cover_source_url,cover_source_name,decision_notes,reviewed_by,created_at")
    .order("created_at", { ascending: false }).range(from, to));
  return rows.filter((row) => isHuman(row.reviewed_by) && ["verified", "rejected"].includes(row.decision))
    .map((row) => ({
      agent_key: "catalogue_curator",
      evaluator_key: "cover_provenance_guard",
      subject_key: `cover:${row.edition_id}`,
      source_decision_table: "cover_review_decisions",
      source_decision_id: row.id,
      input_snapshot: {
        imageUrl: row.cover_image_url,
        sourceUrl: row.cover_source_url,
        sourceName: row.cover_source_name,
        decisionNotes: row.decision_notes,
      },
      expected_outcome: row.decision === "verified" ? "publishable" : "reject",
      reason_label: row.decision,
      reviewed_by: row.reviewed_by,
      decided_at: row.created_at,
    }));
}

async function scoutCases(admin: SupabaseClient): Promise<CandidateCase[]> {
  const decisions = await readHumanScoutDecisions(admin);
  return decisions.map((row) => ({
    agent_key: "market_scout",
    evaluator_key: "market_scout_match",
    subject_key: `scout:${row.leadId}`,
    source_decision_table: "scout_lead_decisions",
    source_decision_id: row.decisionId as string,
    input_snapshot: { listingTitle: row.listingTitle, edition: row.edition },
    expected_outcome: row.decision === "watching" ? "useful" : "dismiss",
    reason_label: row.learningLabel ?? null,
    reviewed_by: row.reviewer,
    decided_at: row.decidedAt,
  }));
}

export async function syncReliabilityBenchmarks(admin: SupabaseClient) {
  const groups = await Promise.all([scoutCases(admin), catalogueCases(admin), saleCases(admin), printCases(admin), coverCases(admin)]);
  const feedbackRows = await readAll<{ workflow: string; subject_key: string; outcome: string; reason_label: string | null; note: string | null; reviewed_by: string; created_at: string }>((from, to) => admin
    .from("agent_human_feedback").select("workflow,subject_key,outcome,reason_label,note,reviewed_by,created_at")
    .order("created_at", { ascending: false }).range(from, to));
  const latestFeedback = new Map<string, typeof feedbackRows[number]>();
  for (const row of feedbackRows) if (!latestFeedback.has(row.subject_key)) latestFeedback.set(row.subject_key, row);
  const candidates = groups.flat().map((candidate) => {
    const feedback = latestFeedback.get(candidate.subject_key);
    return feedback ? {
      ...candidate,
      reason_label: feedback.reason_label ?? candidate.reason_label,
      input_snapshot: { ...candidate.input_snapshot, humanFeedback: { reason: feedback.reason_label, note: feedback.note } },
    } : candidate;
  });
  const existing = await readAll<{ id: string; source_decision_table: string; source_decision_id: string; snapshot_hash: string; subject_key: string; decided_at: string; created_at: string }>((from, to) => admin
    .from("agent_benchmark_cases").select("id,source_decision_table,source_decision_id,snapshot_hash,subject_key,decided_at,created_at")
    .order("created_at", { ascending: false }).range(from, to));
  const existingKeys = new Set(existing.map((row) => `${row.source_decision_table}:${row.source_decision_id}:${row.snapshot_hash}`));
  const latestBySource = new Map<string, typeof existing[number]>();
  for (const row of existing) {
    const key = `${row.source_decision_table}:${row.source_decision_id}`;
    if (!latestBySource.has(key)) latestBySource.set(key, row);
  }

  const inserts = candidates.flatMap((candidate) => {
    const snapshotHash = hashSnapshot({ input: candidate.input_snapshot, expected: candidate.expected_outcome, reason: candidate.reason_label });
    const uniqueKey = `${candidate.source_decision_table}:${candidate.source_decision_id}:${snapshotHash}`;
    if (existingKeys.has(uniqueKey)) return [];
    const previous = latestBySource.get(`${candidate.source_decision_table}:${candidate.source_decision_id}`);
    return [{ ...candidate, snapshot_hash: snapshotHash, supersedes_case_id: previous?.id ?? null }];
  });

  for (let offset = 0; offset < inserts.length; offset += 250) {
    const { error } = await admin.from("agent_benchmark_cases").insert(inserts.slice(offset, offset + 250));
    if (error) throw new Error(`Reliability benchmarks could not be saved: ${error.message}`);
  }
  return { discovered: candidates.length, added: inserts.length, unchanged: candidates.length - inserts.length };
}

export function evaluateReliabilityCase(item: BenchmarkCase): ReliabilityCaseResult {
  const snapshot = asObject(item.input_snapshot);
  let predicted = "reject";
  let score: number | null = null;
  let critical = false;
  let diagnostics: Json = {};

  if (item.evaluator_key === "market_scout_match") {
    const edition = asObject(snapshot.edition) as ScoutEdition;
    const title = typeof snapshot.listingTitle === "string" ? snapshot.listingTitle : "";
    const assessment = assessScoutListing(edition, title);
    const autoDismiss = decideScoutAutoDismiss(edition, title);
    predicted = autoDismiss.shouldDismiss || assessment.score < 50 ? "dismiss" : "useful";
    score = assessment.score;
    critical = item.expected_outcome === "useful" && autoDismiss.shouldDismiss;
    diagnostics = { confidence: assessment.confidence, conflicts: assessment.conflicts, autoDismiss: autoDismiss.shouldDismiss };
  } else if (item.evaluator_key === "catalogue_curator_guard") {
    const queue = asObject(snapshot.queue);
    const title = typeof queue.candidate_title === "string" && Boolean(queue.candidate_title.trim());
    const language = typeof queue.candidate_language === "string" && Boolean(queue.candidate_language.trim());
    const source = validHttpUrl(queue.source_record_url);
    const identity = typeof queue.candidate_isbn_13 === "string" && /^\d{13}$/.test(queue.candidate_isbn_13.replace(/\D/g, ""));
    const publisher = typeof queue.candidate_publisher === "string" && Boolean(queue.candidate_publisher.trim());
    predicted = title && language && source && identity && publisher && queue.candidate_kind === "edition_candidate" ? "publishable" : "reject";
    score = [title, language, source, identity, publisher].filter(Boolean).length * 20;
    critical = item.expected_outcome === "reject" && predicted === "publishable";
    diagnostics = { title, language, source, identity, publisher };
  } else if (item.evaluator_key === "evidence_sale_guard") {
    const observation = asObject(snapshot.observation);
    const confirmed = observation.sale_status === "confirmed";
    const source = validHttpUrl(observation.source_listing_url);
    const price = Number(observation.price) > 0;
    const currency = typeof observation.currency === "string" && /^[A-Z]{3}$/.test(observation.currency);
    const date = typeof observation.sold_date === "string" && Boolean(observation.sold_date);
    const edition = typeof observation.edition_id === "string" && Boolean(observation.edition_id);
    predicted = confirmed && source && price && currency && date && edition ? "eligible" : "reject";
    score = [confirmed, source, price, currency, date, edition].filter(Boolean).length / 6 * 100;
    critical = item.expected_outcome === "reject" && predicted === "eligible";
    diagnostics = { confirmed, source, price, currency, date, edition };
  } else if (item.evaluator_key === "evidence_print_guard") {
    const observation = asObject(snapshot.observation);
    const suggestion = assessPrintingEvidenceSuggestion({ listingTitle: String(observation.listing_title ?? ""), rawPayload: observation.raw_payload });
    predicted = suggestion ? "classifiable" : "unproven";
    score = suggestion ? suggestion.confidence * 100 : 0;
    critical = item.expected_outcome === "unproven" && predicted === "classifiable";
    diagnostics = { suggestedClassification: suggestion?.classification ?? null, proofUrl: suggestion?.evidenceImageUrl ?? null };
  } else if (item.evaluator_key === "cover_provenance_guard") {
    const source = validHttpUrl(snapshot.sourceUrl);
    const image = validHttpUrl(snapshot.imageUrl);
    const named = typeof snapshot.sourceName === "string" && Boolean(snapshot.sourceName.trim());
    predicted = source && image && named ? "publishable" : "reject";
    score = [source, image, named].filter(Boolean).length / 3 * 100;
    critical = item.expected_outcome === "reject" && predicted === "publishable";
    diagnostics = { source, image, named };
  }

  return {
    benchmarkCaseId: item.id,
    expectedOutcome: item.expected_outcome,
    predictedOutcome: predicted,
    score,
    passed: predicted === item.expected_outcome,
    criticalFailure: critical,
    diagnostics,
  };
}

function positiveOutcome(evaluator: ReliabilityEvaluatorKey) {
  if (evaluator === "market_scout_match") return "useful";
  if (evaluator === "evidence_sale_guard") return "eligible";
  if (evaluator === "evidence_print_guard") return "classifiable";
  return "publishable";
}

function calculateMetrics(cases: BenchmarkCase[], results: ReliabilityCaseResult[]) {
  const positive = positiveOutcome(cases[0]?.evaluator_key ?? "market_scout_match");
  const paired = results.map((result) => ({
    expected: result.expectedOutcome === positive,
    predicted: result.predictedOutcome === positive,
  }));
  const positives = paired.filter((row) => row.expected);
  const negatives = paired.filter((row) => !row.expected);
  const tp = positives.filter((row) => row.predicted).length;
  const tn = negatives.filter((row) => !row.predicted).length;
  const fp = negatives.length - tn;
  const fn = positives.length - tp;
  const recall = positives.length ? tp / positives.length : 0;
  const specificity = negatives.length ? tn / negatives.length : 0;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const accuracy = paired.length ? (tp + tn) / paired.length : 0;
  return {
    positive, true_positive: tp, true_negative: tn, false_positive: fp, false_negative: fn,
    accuracy, balanced_accuracy: (recall + specificity) / 2, positive_recall: recall,
    specificity, precision, predicted_review_count: tp + fp,
  };
}

function coverageKey(item: BenchmarkCase) {
  const snapshot = asObject(item.input_snapshot);
  if (item.evaluator_key === "market_scout_match") {
    const edition = asObject(snapshot.edition);
    return [edition.series ?? edition.title, edition.volume_number, edition.language].join("|");
  }
  if (item.evaluator_key === "catalogue_curator_guard") {
    const queue = asObject(snapshot.queue);
    return [queue.candidate_series ?? queue.candidate_title, queue.candidate_volume_number, queue.candidate_language].join("|");
  }
  const observation = asObject(snapshot.observation);
  if (typeof observation.edition_id === "string") return observation.edition_id;
  return item.subject_key;
}

export async function runReliabilitySuite(
  admin: SupabaseClient,
  evaluatorKey: ReliabilityEvaluatorKey,
  initiatedBy: string,
  triggerSource: "manual" | "schedule" | "changed_suite" = "manual",
): Promise<ReliabilityRunSummary> {
  const rows = await readAll<BenchmarkCase>((from, to) => admin.from("agent_benchmark_cases")
    .select("id,agent_key,evaluator_key,subject_key,input_snapshot,expected_outcome,reason_label,reviewed_by,decided_at,created_at")
    .eq("evaluator_key", evaluatorKey).order("decided_at", { ascending: false }).range(from, to));
  const cases = latestBySubject(rows);
  const results = cases.map(evaluateReliabilityCase);
  const metrics = calculateMetrics(cases, results);
  const positiveCount = Number(metrics.true_positive) + Number(metrics.false_negative);
  const negativeCount = Number(metrics.true_negative) + Number(metrics.false_positive);
  const distinctSubjects = new Set(cases.map(coverageKey)).size;
  const criticalFailures = results.filter((item) => item.criticalFailure).length;
  const gates = {
    sample_size: { passed: cases.length >= 20, actual: cases.length, required: 20 },
    positive_examples: { passed: positiveCount >= 5, actual: positiveCount, required: 5 },
    negative_examples: { passed: negativeCount >= 5, actual: negativeCount, required: 5 },
    subject_coverage: { passed: distinctSubjects >= 3, actual: distinctSubjects, required: 3 },
    critical_safety_regressions: { passed: criticalFailures === 0, actual: criticalFailures, required: 0 },
    positive_recall: { passed: Number(metrics.positive_recall) >= 0.8, actual: Number(metrics.positive_recall), required: 0.8 },
    balanced_accuracy: { passed: Number(metrics.balanced_accuracy) >= 0.7, actual: Number(metrics.balanced_accuracy), required: 0.7 },
  };
  const passed = Object.values(gates).every((gate) => gate.passed);
  const agentKey = cases[0]?.agent_key ?? (evaluatorKey.startsWith("market_") ? "market_scout" : evaluatorKey.startsWith("catalogue_") || evaluatorKey.startsWith("cover_") ? "catalogue_curator" : "evidence_auditor");
  const createdAt = new Date().toISOString();
  const { data: run, error: runError } = await admin.from("agent_evaluation_runs").insert({
    agent_key: agentKey,
    evaluator_key: evaluatorKey,
    evaluator_version: EVALUATOR_VERSION,
    trigger_source: triggerSource,
    status: "completed",
    case_count: cases.length,
    positive_count: positiveCount,
    negative_count: negativeCount,
    distinct_subjects: distinctSubjects,
    metrics,
    gates,
    passed,
    regression_count: criticalFailures,
    initiated_by: initiatedBy,
    created_at: createdAt,
  }).select("id").single();
  if (runError || !run) throw new Error(`Reliability result could not be saved: ${runError?.message ?? "unknown error"}`);
  for (let offset = 0; offset < results.length; offset += 250) {
    const { error } = await admin.from("agent_evaluation_case_results").insert(results.slice(offset, offset + 250).map((result) => ({
      evaluation_run_id: run.id,
      benchmark_case_id: result.benchmarkCaseId,
      expected_outcome: result.expectedOutcome,
      predicted_outcome: result.predictedOutcome,
      score: result.score,
      passed: result.passed,
      critical_failure: result.criticalFailure,
      diagnostics: result.diagnostics,
    })));
    if (error) throw new Error(`Reliability case results could not be saved: ${error.message}`);
  }

  if (criticalFailures > 0) {
    await admin.from("agent_incidents").upsert({
      incident_key: `reliability:${evaluatorKey}`,
      incident_type: "rule_regression",
      severity: "critical",
      status: "open",
      title: `${evaluatorKey.replaceAll("_", " ")} failed a safety gate`,
      details: { evaluation_run_id: run.id, critical_failures: criticalFailures },
    }, { onConflict: "incident_key", ignoreDuplicates: true });
  }

  return { id: run.id, evaluatorKey, agentKey, passed, caseCount: cases.length, positiveCount, negativeCount, distinctSubjects, regressionCount: criticalFailures, metrics, gates, createdAt };
}

export async function runChangedReliabilitySuites(admin: SupabaseClient, initiatedBy: string, triggerSource: "manual" | "schedule" | "changed_suite" = "changed_suite") {
  const sync = await syncReliabilityBenchmarks(admin);
  const runs: ReliabilityRunSummary[] = [];
  for (const evaluatorKey of RELIABILITY_EVALUATORS) {
    const [{ data: latestCase }, { data: latestRun }] = await Promise.all([
      admin.from("agent_benchmark_cases").select("created_at").eq("evaluator_key", evaluatorKey).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("agent_evaluation_runs").select("created_at,evaluator_version").eq("evaluator_key", evaluatorKey).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const changed = Boolean(latestCase && (!latestRun || Date.parse(latestCase.created_at) > Date.parse(latestRun.created_at) || latestRun.evaluator_version !== EVALUATOR_VERSION));
    if (changed || triggerSource === "manual") runs.push(await runReliabilitySuite(admin, evaluatorKey, initiatedBy, triggerSource));
  }
  return { sync, runs };
}

export async function readReliabilityDashboard(admin: SupabaseClient) {
  const { data: runRows, error } = await admin.from("agent_evaluation_runs")
    .select("id,agent_key,evaluator_key,passed,case_count,positive_count,negative_count,distinct_subjects,regression_count,metrics,gates,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (error?.code === "42P01" || error?.code === "PGRST205") return { ready: false, suites: [], operator: null };
  if (error) throw new Error(`Reliability dashboard could not load: ${error.message}`);
  const latest = new Map<string, Json>();
  for (const row of runRows ?? []) if (!latest.has(row.evaluator_key)) latest.set(row.evaluator_key, row as Json);
  const latestRunIds = [...latest.values()].map((row) => String(row.id));
  const { data: failureRows } = latestRunIds.length ? await admin.from("agent_evaluation_case_results")
    .select("evaluation_run_id,expected_outcome,predicted_outcome,score,critical_failure,diagnostics,case:agent_benchmark_cases(subject_key,reason_label,input_snapshot)")
    .in("evaluation_run_id", latestRunIds).eq("passed", false).order("critical_failure", { ascending: false }).limit(30) : { data: [] };
  const failuresByRun = new Map<string, unknown[]>();
  for (const row of failureRows ?? []) failuresByRun.set(row.evaluation_run_id, [...(failuresByRun.get(row.evaluation_run_id) ?? []), row]);
  const { data: operatorRuns } = await admin.from("agent_runs").select("status,started_at").order("started_at", { ascending: false }).limit(100);
  const completed = (operatorRuns ?? []).filter((row) => row.status === "succeeded").length;
  const attention = (operatorRuns ?? []).filter((row) => row.status !== "succeeded").length;
  return {
    ready: true,
    suites: RELIABILITY_EVALUATORS.map((key) => {
      const latestRun = latest.get(key) ?? null;
      return { evaluatorKey: key, latest: latestRun, failures: latestRun ? failuresByRun.get(String(latestRun.id)) ?? [] : [] };
    }),
    operator: { examined: operatorRuns?.length ?? 0, completed, attention, reliability: operatorRuns?.length ? completed / operatorRuns.length : null },
  };
}

export function isReliabilityEvaluatorKey(value: unknown): value is ReliabilityEvaluatorKey {
  return typeof value === "string" && (RELIABILITY_EVALUATORS as readonly string[]).includes(value);
}
