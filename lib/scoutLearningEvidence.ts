import { createHash } from "node:crypto";
import { looksGraded } from "./editionMatch.ts";
import { assessScoutListing, type ScoutEdition } from "./scoutIngest.ts";
import type { HumanScoutDecision } from "./scoutFeedback.ts";
import type { ScoutRule } from "./scoutRules.ts";

const normal = (value: unknown) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const LEARNING_PROTOCOL = "scout-learning-v2";

export function learningScope(edition: ScoutEdition) {
  return [edition.series || edition.title, edition.language, edition.publisher, edition.format,
    edition.printing_number, edition.collectible_type || "tankobon"].map(normal).join("|");
}

function titleKey(item: HumanScoutDecision) {
  return `${learningScope(item.edition)}|${normal(item.listingTitle)}`;
}

// Group duplicate captures and matching titles before splitting. One eBay item
// captured by different profiles must never be both an example and a test case.
export function learningGroups(decisions: HumanScoutDecision[]) {
  const parents = new Map<string, string>();
  function root(key: string): string {
    const parent = parents.get(key);
    if (!parent) { parents.set(key, key); return key; }
    if (parent === key) return key;
    const result = root(parent); parents.set(key, result); return result;
  }
  for (const item of decisions) {
    const a = root(`title:${titleKey(item)}`);
    const b = root(item.listingKey || `lead:${item.leadId}`);
    if (a !== b) parents.set(a > b ? a : b, a > b ? b : a);
  }
  const groups = new Map<string, HumanScoutDecision[]>();
  for (const item of decisions) {
    const key = root(`title:${titleKey(item)}`);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, rows]) => ({ key, rows }));
}

export function splitLearningDecisions(decisions: HumanScoutDecision[]) {
  const development: HumanScoutDecision[] = [];
  const holdout: HumanScoutDecision[] = [];
  for (const group of learningGroups(decisions)) {
    const bucket = createHash("sha256").update(`${LEARNING_PROTOCOL}|${group.key}`).digest().readUInt32BE(0) % 5;
    (bucket === 0 ? holdout : development).push(...group.rows);
  }
  return { development, holdout };
}

// A Watch can mean "interesting", and a Dismiss can mean "too expensive".
// Only explicit edition judgements measure edition matching.
export function editionMatchOutcome(item: HumanScoutDecision): boolean | null {
  if (item.decision === "watching" && item.learningLabel === "exact_match") return true;
  if (item.decision === "dismissed" && ["edition_mismatch", "multi_volume_lot"].includes(item.learningLabel ?? "")) return false;
  return null;
}

export type RelatedScoutDecision = {
  decisionId: string; title: string; decision: string; reason: string | null; note: string | null;
};

export function createScoutMemory(decisions: HumanScoutDecision[]) {
  const scopes = new Map<string, HumanScoutDecision[]>();
  for (const item of splitLearningDecisions(decisions).development) {
    const key = `${learningScope(item.edition)}|${looksGraded(item.listingTitle)}`;
    scopes.set(key, [...(scopes.get(key) ?? []), item]);
  }
  return (edition: ScoutEdition, title: string, excludeLeadIds: string[] = [], listingKey?: string): RelatedScoutDecision[] => {
    const tokens = new Set(normal(title).split(" "));
    const candidates = (scopes.get(`${learningScope(edition)}|${looksGraded(title)}`) ?? [])
      .filter(item => !excludeLeadIds.includes(item.leadId) && (!listingKey || item.listingKey !== listingKey)
        && normal(item.listingTitle) !== normal(title) && (item.learningLabel || item.notes))
      .map(item => {
        const other = new Set(normal(item.listingTitle).split(" "));
        const shared = [...tokens].filter(token => other.has(token)).length;
        return { item, similarity: shared / new Set([...tokens, ...other]).size };
      }).filter(row => row.similarity >= 0.35)
      .sort((a, b) => b.similarity - a.similarity || b.item.decidedAt.localeCompare(a.item.decidedAt));
    // Include a counterexample when available instead of presenting only
    // approving neighbours. Similarity never changes a score or a decision.
    const chosen = candidates.slice(0, 3);
    const counter = candidates.find(row => row.item.decision !== chosen[0]?.item.decision);
    if (counter && !chosen.includes(counter)) chosen[chosen.length - 1] = counter;
    return chosen.map(({ item }) => ({ decisionId: item.decisionId || item.leadId, title: item.listingTitle,
      decision: item.decision, reason: item.learningLabel ?? null, note: item.notes?.slice(0, 500) || null }));
  };
}

function wilson(successes: number, total: number) {
  const z = 1.96, p = successes / total, denominator = 1 + z * z / total;
  const centre = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return { low: Math.round((centre - margin) * 100), high: Math.round((centre + margin) * 100) };
}

export function measureScoutConfidence(decisions: HumanScoutDecision[], rules: ScoutRule[] = []) {
  const buckets = new Map<string, { language: string; kind: string; band: string; samples: number; matches: number; scores: number }>();
  let excluded = 0;
  for (const { rows } of learningGroups(decisions)) {
    const latest = [...rows].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
    const outcome = editionMatchOutcome(latest);
    // Conflicting labels within a duplicate cluster are not reliable truth.
    const outcomes = new Set(rows.map(editionMatchOutcome).filter(x => x !== null));
    if (outcome === null || outcomes.size > 1) { excluded += 1; continue; }
    const assessment = assessScoutListing(latest.edition, latest.listingTitle, rules);
    const band = assessment.confidence === "conflict" ? "Conflict" : assessment.score >= 90 ? "90–100" : assessment.score >= 75 ? "75–89" : assessment.score >= 50 ? "50–74" : "0–49";
    const language = latest.edition.language || "Unknown language";
    const kind = looksGraded(latest.listingTitle) ? "Graded" : "Raw";
    const key = `${normal(language)}|${kind}|${band}`;
    const bucket = buckets.get(key) ?? { language, kind, band, samples: 0, matches: 0, scores: 0 };
    bucket.samples++; bucket.matches += Number(outcome); bucket.scores += assessment.score;
    buckets.set(key, bucket);
  }
  return { protocol: LEARNING_PROTOCOL, excluded, buckets: [...buckets.values()].map(row => ({
    language: row.language, kind: row.kind, band: row.band, samples: row.samples, matches: row.matches,
    meanScore: Math.round(row.scores / row.samples), observedMatchPercent: Math.round(100 * row.matches / row.samples),
    interval: wilson(row.matches, row.samples), enoughEvidence: row.samples >= 20,
  })).sort((a, b) => a.language.localeCompare(b.language) || a.kind.localeCompare(b.kind) || a.band.localeCompare(b.band)) };
}

// Only decisions collected AFTER the candidate was frozen count toward its
// promotion gate. Older results remain useful regression tests, not unseen data.
export function prospectiveHoldout(decisions: HumanScoutDecision[], createdAt?: string) {
  const cutoff = Date.parse(createdAt ?? "");
  if (!Number.isFinite(cutoff)) return [];
  return learningGroups(decisions).filter(group => group.rows.every(item => Date.parse(item.decidedAt) > cutoff
    && Date.parse(item.firstSeenAt ?? item.decidedAt) > cutoff))
    .flatMap(group => splitLearningDecisions(group.rows).holdout);
}
