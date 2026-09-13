import type { SupabaseClient } from "@supabase/supabase-js";
import { detectGrading, detectsBestOffer } from "./submittedSale.ts";
import { validateObservedSaleEvidence } from "./listingOutcome.ts";
import { extractEbayLegacyItemId } from "./ebayEvidence.ts";

export type OutcomeSale = {
  id: string; status: string; edition_id: string; source_id: string;
  external_id: string; source_listing_url: string; listing_title: string;
  sold_price: number | null; sold_currency: string | null; sold_at: string | null;
  buying_format: string | null; original_snapshot: Record<string, unknown> | null;
  outcome_provider: string | null; outcome_reason: string | null;
};

export type OutcomeSaleConfirmation = {
  humanConfirmed?: boolean;
  grading?: string;
  gradingCompany?: string;
  gradeLabel?: string;
  priceCorroborationUrl?: string;
};

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function httpUrl(value: string) {
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}

export function outcomeIsBestOffer(buyingFormat: string | null, title: string) {
  return (buyingFormat ?? "").toUpperCase().includes("OFFER") || detectsBestOffer(title);
}

export function outcomeSaleFields(outcome: OutcomeSale, confirmation: OutcomeSaleConfirmation) {
  if (confirmation.humanConfirmed !== true) throw new Error("Confirm that you inspected the working original source, exact edition and paid item price for one copy, excluding delivery.");
  if (outcome.status !== "sold_candidate") throw new Error("Only a sold candidate can be confirmed as a sale.");
  const problem = validateObservedSaleEvidence({ soldPrice: Number(outcome.sold_price), soldCurrency: outcome.sold_currency ?? "", soldAt: outcome.sold_at ?? "" });
  if (problem) throw new Error(problem);
  if (!httpUrl(outcome.source_listing_url)) throw new Error("A working original listing link is required.");
  if (!["raw", "graded"].includes(confirmation.grading ?? "")) throw new Error("Confirm whether this copy is raw or graded.");
  const detection = detectGrading(outcome.listing_title);
  if (detection.isGraded && confirmation.grading === "raw") throw new Error("This listing mentions grading. Use Add sale to inspect and correct its grading details before verification.");
  const company = confirmation.grading === "graded" ? clean(confirmation.gradingCompany).toUpperCase() : "";
  const grade = confirmation.grading === "graded" ? clean(confirmation.gradeLabel) : "";
  if (confirmation.grading === "graded" && (!company || !grade)) throw new Error("Confirm both the grading company and exact grade.");
  const bestOffer = outcomeIsBestOffer(outcome.buying_format, outcome.listing_title);
  // Reuse the corroboration a human already recorded; do not ask them to
  // provide the same source twice. A provider label alone never verifies it.
  const corroboration = clean(confirmation.priceCorroborationUrl)
    || (outcome.outcome_provider === "130point manual corroboration" ? "https://130point.com/sales/" : "");
  if (bestOffer && !httpUrl(corroboration)) throw new Error("Best Offer needs a link confirming the actual accepted price. The advertised price is not evidence.");
  return {
    company: company || null, grade: grade || null,
    saleType: bestOffer ? "best_offer" : outcome.buying_format?.includes("AUCTION") ? "auction" : outcome.buying_format?.includes("FIXED_PRICE") ? "fixed_price" : "unknown",
    corroboration: corroboration || null,
    detection,
  };
}

/** The legacy numeric listing id held on an outcome row.
 *
 * eBay's Browse API returns `v1|123456789012|0` while Trading, the legacy APIs
 * and the listing URL itself all use the bare number. The uniqueness rule on a
 * sale is (source, listing id), so the two spellings would otherwise count as
 * two different listings and the same sale could be stored twice. */
export function storedLegacyItemId(externalId: string) {
  return externalId.match(/^v\d+\|(\d{6,})\|\d+$/)?.[1] ?? externalId.trim();
}

/**
 * One human approval, one indivisible write.
 *
 * Everything -- locking the outcome, checking it is still eligible, creating
 * or reusing the verified observation with its review, print-classification
 * and intake audit rows, and closing the watch queue -- happens inside a
 * single database transaction (`confirm_outcome_sale`). Previously the sale
 * was transactional but the queue closure was a separate write, so a crash or
 * a concurrent decision in between left verified evidence attached to an
 * outcome that was still being offered to a human, or to one another person
 * had meanwhile dismissed.
 *
 * The validation below stays here rather than moving into SQL because it is
 * what produces the wording a member of staff reads. The database repeats the
 * structural parts of it, so a future caller that skips this function cannot
 * write evidence that these rules would have refused.
 */
export async function confirmOutcomeSale(
  admin: SupabaseClient, outcome: OutcomeSale, confirmation: OutcomeSaleConfirmation,
  reviewer: string, notes: string | null,
) {
  const fields = outcomeSaleFields(outcome, confirmation);
  const legacyId = extractEbayLegacyItemId(outcome.source_listing_url);
  const storedLegacyId = storedLegacyItemId(outcome.external_id);
  if (!legacyId || legacyId !== storedLegacyId) throw new Error("The original eBay link and stored listing ID do not agree. Resolve the source before verifying.");

  const { data, error } = await admin.rpc("confirm_outcome_sale", {
    p_outcome_id: outcome.id,
    p_legacy_external_id: legacyId,
    p_sale_type: fields.saleType,
    p_grading_company: fields.company,
    p_grade_label: fields.grade,
    p_price_corroboration_url: fields.corroboration,
    p_submitted_payload: {
      original_snapshot: outcome.original_snapshot, outcome_id: outcome.id,
      rar_outcome_evidence: { provider: outcome.outcome_provider, reason: outcome.outcome_reason },
      human_confirmation: { ...confirmation, single_copy_item_price_excludes_delivery: true },
    },
    p_detector_output: { grading: fields.detection },
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
  });

  if (error) {
    // The database raises messages written for the person reading them, so
    // they are passed through. Only the two cases whose Postgres wording is
    // unhelpful get translated, and neither invents a reassurance: a rolled
    // back transaction genuinely leaves nothing behind.
    const message = error.message ?? "";
    if (message.includes("already exists in RAR")) {
      throw new Error("Another request saved this listing a moment ago. Retry to close the outcome; the sale will not be duplicated.");
    }
    if (/function .*confirm_outcome_sale.* does not exist|schema cache/i.test(message)) {
      throw new Error("RAR's sale-confirmation database function is missing. Apply the outstanding migration before verifying sales; nothing was written.");
    }
    throw new Error(message || "The sale could not be saved. Nothing was verified; refresh and retry.");
  }
  if (!data) throw new Error("The sale could not be saved. Nothing was verified; refresh and retry.");

  const result = data as { ok: boolean; status: string; observationId: string; reused: boolean; alreadyClosed: boolean };
  return {
    ok: result.ok, status: result.status, observationId: result.observationId,
    reused: result.reused, alreadyClosed: result.alreadyClosed,
  };
}
