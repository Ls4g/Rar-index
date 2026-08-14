export type CatalogueReviewMetadata = {
  collectible_type: string | null;
  magazine_title_id: string | null;
  issue_year: string | null;
  issue_number_label: string | null;
  cumulative_issue_no: string | null;
  madb_id: string | null;
};

type QueuePayload = {
  review_metadata?: Record<string, unknown> | null;
} | null;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

// Source-owned identity must survive both individual and bulk approval.
// Keeping it server-side prevents a browser form from silently turning a
// queued magazine into the database's default tankobon record.
export function queuedReviewMetadata(rawPayload: unknown): CatalogueReviewMetadata {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload as QueuePayload : null;
  const input = payload?.review_metadata && typeof payload.review_metadata === "object"
    ? payload.review_metadata
    : {};
  return {
    collectible_type: text(input.collectible_type),
    magazine_title_id: text(input.magazine_title_id),
    issue_year: text(input.issue_year),
    issue_number_label: text(input.issue_number_label),
    cumulative_issue_no: text(input.cumulative_issue_no),
    madb_id: text(input.madb_id),
  };
}

export function catalogueMetadataProblem(metadata: CatalogueReviewMetadata) {
  const hasMagazineIdentity = Boolean(metadata.magazine_title_id || metadata.issue_year || metadata.issue_number_label || metadata.cumulative_issue_no);
  if (metadata.collectible_type !== "zasshi") {
    return hasMagazineIdentity
      ? "This candidate contains magazine identity fields but is not marked as a magazine. Keep it in review instead of approving it."
      : null;
  }
  if (!metadata.magazine_title_id || !metadata.issue_year || !metadata.issue_number_label) {
    return "This magazine candidate is missing its magazine, year, or printed issue number. Keep it in review instead of approving it.";
  }
  return null;
}
