import { detectGrading } from "./submittedSale.ts";

export type GradingEvidence = {
  listing_title?: string | null;
  grading_company: string | null;
  grade_label: string | null;
  // Set once a human has opened the original listing and stated what the copy
  // actually is. Absent on every sale recorded before that workflow existed,
  // which is why it is optional rather than required.
  grading_reviewed_at?: string | null;
};

/**
 * Is this sale's grading contradictory?
 *
 * Two ways it can be. Half a grade -- a company with no grade, or a grade with
 * no company -- is incomplete on its face. And a title that mentions grading
 * while both columns are empty means the sale claims to be raw evidence while
 * its own source says otherwise.
 *
 * A title is a conflict signal, never proof of a grading company or a grade.
 * So the answer is to withhold the sale from calculations until a human
 * resolves it, never to write a grade nobody confirmed. The original
 * observation and its human audit are left untouched throughout.
 *
 * Once a human HAS looked -- recorded by `grading_reviewed_at` through
 * `record_observation_grading` -- their answer settles it. That matters for
 * the raw case specifically: a listing whose title mentions grading but whose
 * copy is genuinely raw (a seller comparing against a graded sale, say) would
 * otherwise stay withheld for ever, with no way for anyone to say so.
 */
export function hasUnresolvedGrading(sale: GradingEvidence) {
  const company = Boolean(sale.grading_company?.trim());
  const grade = Boolean(sale.grade_label?.trim());
  if (company !== grade) return true;
  if (company) return false;
  if (sale.grading_reviewed_at) return false;
  return detectGrading(sale.listing_title ?? "").isGraded;
}

export function isRawValuationEvidence(sale: GradingEvidence) {
  return sale.grading_company === null && sale.grade_label === null && !hasUnresolvedGrading(sale);
}
