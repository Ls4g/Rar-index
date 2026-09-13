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

/** One human approval, one transactional evidence write. Closing the watch
 * queue is retryable independently; an existing observation is never reviewed
 * again or silently reassigned to another edition. */
export async function confirmOutcomeSale(
  admin: SupabaseClient, outcome: OutcomeSale, confirmation: OutcomeSaleConfirmation,
  reviewer: string, notes: string | null,
) {
  const fields = outcomeSaleFields(outcome, confirmation);
  const legacyId = extractEbayLegacyItemId(outcome.source_listing_url);
  const storedLegacyId = outcome.external_id.match(/^v1\|(\d{9,})\|\d+$/)?.[1] ?? outcome.external_id;
  if (!legacyId || legacyId !== storedLegacyId) throw new Error("The original eBay link and stored listing ID do not agree. Resolve the source before verifying.");
  const { data: existing, error: lookupError } = await admin.from("price_observations")
    .select("id,edition_id,match_status,sale_status,is_verified")
    .eq("source_id", outcome.source_id)
    .or(`external_id.eq.${legacyId},external_id.like.v1|${legacyId}|%`).maybeSingle();
  if (lookupError) throw new Error("RAR could not check for an existing sale. Retry; nothing was written.");
  let observationId: string;
  if (existing) {
    if (existing.edition_id !== outcome.edition_id) throw new Error("This listing already belongs to another edition. Open sale review to resolve the match; nothing was changed.");
    if (existing.match_status !== "verified_match" || existing.sale_status !== "confirmed" || !existing.is_verified) {
      throw new Error("This listing already has an unverified or excluded observation. Finish it in sale review; its existing decision was not changed.");
    }
    observationId = existing.id;
  } else {
    const { data, error } = await admin.rpc("approve_submitted_sale", {
      p_edition_id: outcome.edition_id, p_source_id: outcome.source_id,
      p_source_listing_url: outcome.source_listing_url, p_external_id: legacyId,
      p_listing_title: outcome.listing_title, p_sold_date: outcome.sold_at?.slice(0, 10),
      p_sale_price: outcome.sold_price, p_currency: outcome.sold_currency,
      p_shipping_price: null, p_quantity: 1, p_sale_type: fields.saleType,
      p_grading_company: fields.company, p_grade_label: fields.grade,
      p_print_classification: "printing_not_identified", p_printing_proof_url: null,
      p_known_printing_number: null, p_price_corroboration_url: fields.corroboration,
      p_submitted_payload: { original_snapshot: outcome.original_snapshot, outcome_id: outcome.id,
        rar_outcome_evidence: { provider: outcome.outcome_provider, reason: outcome.outcome_reason },
        human_confirmation: { ...confirmation, single_copy_item_price_excludes_delivery: true } },
      p_detector_output: { grading: fields.detection },
      p_decision_notes: notes ?? `Confirmed from watched eBay listing ${outcome.external_id}.`,
      p_reviewed_by: reviewer,
    });
    if (error || !data) throw new Error(error?.message.includes("already exists")
      ? "Another request saved this listing. Retry to close the outcome without duplicating the sale."
      : "The sale and its audit could not be saved. Retry; no partial sale was created by this approval.");
    observationId = String(data);
  }
  const now = new Date().toISOString();
  const { data: closed, error: closeError } = await admin.from("listing_outcomes").update({
    status: "review_complete", resulting_observation_id: observationId,
    reviewed_by: reviewer, reviewed_at: now, review_notes: notes,
    next_check_at: null, updated_at: now,
  }).eq("id", outcome.id).eq("status", "sold_candidate").is("reviewed_by", null)
    .is("resulting_observation_id", null).select("id").maybeSingle();
  if (closeError || !closed) throw new Error("The verified sale is saved, but the watch queue could not close. Refresh and retry; the sale will not be created or verified again.");
  return { ok: true, status: "review_complete", observationId, reused: Boolean(existing) };
}
