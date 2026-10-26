// Discovery is not sale proof. These predicates only choose which unresolved
// listings staff sees first; every sale still needs the existing human check.
export const APIFY_SOLD_SEARCH_PROVIDER = "apify_ebay_sold_search";

export type SalesInboxOutcome = {
  status: string;
  discovery_provider: string | null;
  reviewed_by: string | null;
  resulting_observation_id: string | null;
  check_attempts?: number;
  next_check_at?: string | null;
};

const REVIEW_STATUSES = new Set(["ended_pending_check", "sold_candidate", "ambiguous", "inaccessible"]);

export function needsSalesReview(outcome: SalesInboxOutcome) {
  // Five inconclusive checks are the end of automatic work, not another
  // decision for staff. Keep the record and its checks for the history view.
  if (isExhaustedUnknown(outcome)) return false;
  return !outcome.reviewed_by && !outcome.resulting_observation_id && REVIEW_STATUSES.has(outcome.status);
}

export function isExhaustedUnknown(outcome: SalesInboxOutcome) {
  return outcome.status === "ambiguous"
    && (outcome.check_attempts ?? 0) >= 5
    && !outcome.next_check_at;
}

export function isCurrentSalesFinding(outcome: SalesInboxOutcome) {
  return needsSalesReview(outcome) && (
    outcome.discovery_provider === APIFY_SOLD_SEARCH_PROVIDER || outcome.status === "sold_candidate"
  );
}

export function isOlderWatchedListing(outcome: SalesInboxOutcome) {
  return needsSalesReview(outcome) && !isCurrentSalesFinding(outcome);
}
