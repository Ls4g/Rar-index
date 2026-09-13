import { detectGrading } from "./submittedSale.ts";

export type GradingEvidence = {
  listing_title?: string | null;
  grading_company: string | null;
  grade_label: string | null;
};

// A title is a conflict signal, never proof of a grading company or grade.
// Withhold contradictory evidence from calculations until staff correct it;
// leave the original observation and its human audit untouched.
export function hasUnresolvedGrading(sale: GradingEvidence) {
  const company = Boolean(sale.grading_company?.trim());
  const grade = Boolean(sale.grade_label?.trim());
  return company !== grade || (!company && detectGrading(sale.listing_title ?? "").isGraded);
}

export function isRawValuationEvidence(sale: GradingEvidence) {
  return sale.grading_company === null && sale.grade_label === null && !hasUnresolvedGrading(sale);
}
