// Which decisions a watched listing offers, and which of those may be applied
// to a whole selection at once.
//
// This lives in one module because the answer has to be identical in two
// places: the buttons the panel renders, and the guard the API applies. If the
// UI decided what was bulk-safe and the endpoint decided separately, the two
// would drift, and the drift would show up as evidence created by a rule
// nobody meant to relax.

export type OutcomeDecisionKey =
  | "confirm_sale"
  | "keep_watching"
  | "mark_unsold"
  | "wrong_edition"
  | "mark_ambiguous"
  | "dismiss";

export type OutcomeDecision = { key: OutcomeDecisionKey; label: string; tone?: string };

export const OUTCOME_DECISIONS: OutcomeDecision[] = [
  { key: "confirm_sale", label: "Yes — verify this sale", tone: "primary" },
  { key: "keep_watching", label: "Still live — keep watching", tone: "watch" },
  { key: "mark_unsold", label: "No — it did not sell" },
  { key: "wrong_edition", label: "Wrong edition" },
  { key: "mark_ambiguous", label: "Not enough evidence" },
  { key: "dismiss", label: "Remove from queue" },
];

/**
 * Verifying a sale is never available in bulk.
 *
 * It is the one decision here that creates evidence: it writes a
 * price_observation and verifies it in the same action. RAR's rule is that a
 * sale attaches to the exact edition, confirmed by a human who looked — and
 * looking is exactly what a row of checkboxes replaces. Scout's bulk bar draws
 * the same line, batching Watch and Dismiss but never a verification.
 *
 * Everything else is triage: it records what a human concluded and, apart from
 * keep_watching, creates nothing at all.
 */
export const BULK_SAFE_DECISIONS: OutcomeDecisionKey[] = [
  "keep_watching",
  "mark_unsold",
  "wrong_edition",
  "mark_ambiguous",
  "dismiss",
];

export function isBulkSafeDecision(decision: string): decision is OutcomeDecisionKey {
  return (BULK_SAFE_DECISIONS as string[]).includes(decision);
}

export type DecidableOutcome = {
  status: string;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
};

/** The decisions a single listing may be given, from its own state. */
export function decisionsFor(row: DecidableOutcome): OutcomeDecision[] {
  return OUTCOME_DECISIONS.filter((decision) => {
    if (decision.key === "confirm_sale") {
      // No price, no currency, no date — no sale. The confirm path refuses
      // these anyway; the button should not pretend otherwise.
      return row.status === "sold_candidate" && row.soldPrice !== null && Boolean(row.soldCurrency && row.soldAt);
    }
    if (decision.key === "keep_watching") {
      return ["ended_pending_check", "ambiguous", "inaccessible"].includes(row.status);
    }
    // A live listing has not failed to sell; it simply has not finished.
    if (decision.key === "mark_unsold" && row.status === "active") return false;
    return true;
  });
}

/**
 * The decisions valid for EVERY row in a selection.
 *
 * An intersection rather than a union, so a batch can never apply an action to
 * a listing whose own buttons would have refused it — selecting a live listing
 * alongside an ended one must not make "it did not sell" available for both.
 */
export function sharedDecisionsFor(rows: DecidableOutcome[]): OutcomeDecision[] {
  if (!rows.length) return [];
  return OUTCOME_DECISIONS.filter((decision) =>
    isBulkSafeDecision(decision.key)
    && rows.every((row) => decisionsFor(row).some((allowed) => allowed.key === decision.key)));
}
