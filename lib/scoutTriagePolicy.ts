export const SCOUT_REVIEW_NOW_MIN_SCORE = 65;
export const SCOUT_HIGH_CONFIDENCE_MIN_SCORE = 75;

export function isScoutReviewNowScore(score: number) {
  return score >= SCOUT_REVIEW_NOW_MIN_SCORE;
}

export function isScoutNeedsEvidenceScore(score: number) {
  return score >= 50 && score < SCOUT_REVIEW_NOW_MIN_SCORE;
}
