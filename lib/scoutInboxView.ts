import { SCOUT_HIGH_CONFIDENCE_MIN_SCORE, SCOUT_REVIEW_NOW_MIN_SCORE, isScoutNeedsEvidenceScore } from "./scoutTriagePolicy.ts";

export const SCOUT_VIEW_KEYS = ["reviewNow", "highConfidence", "needsEvidence", "endsSoon", "graded", "watching", "surplusBackups", "staleBacklog", "lowConfidenceBacklog", "dismissed"] as const;
export type ScoutView = typeof SCOUT_VIEW_KEYS[number];

type ViewLead = {
  reviewStatus: string;
  isExpired: boolean;
  isStale: boolean;
  isSurplusBackup: boolean;
  isGraded: boolean;
  score: number;
  itemEndAt: string | null;
};

export function isScoutView(value: string | undefined): value is ScoutView {
  return SCOUT_VIEW_KEYS.some((key) => key === value);
}

export function matchesScoutView(lead: ViewLead, view: ScoutView, now: number): boolean {
  if (view === "dismissed") return lead.reviewStatus === "dismissed";
  if (view === "watching") return lead.reviewStatus === "watching";
  if (view === "staleBacklog") return lead.reviewStatus === "new" && lead.isStale;
  if (view === "lowConfidenceBacklog") return lead.reviewStatus === "new" && !lead.isExpired && !lead.isStale && lead.score < 50;
  if (view === "surplusBackups") return lead.reviewStatus === "new" && lead.isSurplusBackup;
  if (lead.reviewStatus !== "new" || lead.isExpired || lead.isStale || lead.isSurplusBackup) return false;
  if (view === "graded") return lead.isGraded;
  if (lead.isGraded) return false;
  if (view === "reviewNow") return lead.score >= SCOUT_REVIEW_NOW_MIN_SCORE;
  if (view === "highConfidence") return lead.score >= SCOUT_HIGH_CONFIDENCE_MIN_SCORE;
  if (view === "needsEvidence") return isScoutNeedsEvidenceScore(lead.score);
  if (!lead.itemEndAt) return false;
  const end = Date.parse(lead.itemEndAt);
  return view === "endsSoon" && end > now && end - now <= 48 * 60 * 60 * 1000;
}
