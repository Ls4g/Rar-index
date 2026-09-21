import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { captureWatchedListings, promoteEndedListings, runOutcomeChecks } from "@/lib/watchToSale";
import { probeOutcomeProviders, tradingOutcomeProvider } from "@/lib/listingOutcomeProviders";
import { ebayItemPrice, validateEbayDisplayedSaleEvidence, validateManualBestOfferEvidence } from "@/lib/listingOutcome";
import { confirmOutcomeSale, outcomeIsBestOffer, type OutcomeSaleConfirmation } from "@/lib/outcomeSaleConfirmation";
import { outcomeHumanSnoozedUntil } from "@/lib/outcomeHumanAttention";
import { isBulkSafeDecision } from "@/lib/listingOutcomeDecisions";
import { classifyStaffPageSignal, type StaffPageSignal } from "@/lib/listingPageEvidence";
import { snapshotHoldersOfEdition } from "@/lib/portfolioSnapshot";

// Watch-to-Sale staff endpoint.
//
// Two jobs: run the pipeline (capture, promote, check), and record a human
// decision about a sold candidate. Everything that could create evidence goes
// through the decision path, and only ever on an explicit staff action.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DecisionBody = OutcomeSaleConfirmation & {
  action?: string;
  outcomeId?: string;
  outcomeIds?: string[];
  decision?: "confirm_sale" | "keep_watching" | "mark_unsold" | "wrong_edition" | "mark_ambiguous" | "dismiss";
  reviewer?: string;
  notes?: string;
  soldPrice?: number;
  displayedTotal?: number;
  buyerProtectionFee?: number;
  soldCurrency?: string;
  soldAt?: string;
  pageSignal?: StaffPageSignal;
};

// One request should not sit on the connection while it walks a whole queue.
const BULK_LIMIT = 200;
const BULK_CONCURRENCY = 6;

type DecisionResult = { ok: true; status: string } | { ok: false; error: string; httpStatus: number };

async function capabilitySample(admin: ReturnType<typeof getSupabaseAdmin>) {
  const { data } = await admin
    .from("listing_outcomes")
    .select("external_id,marketplace")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? { itemId: data.external_id as string, marketplace: (data.marketplace as string | null) ?? null } : undefined;
}

// Mirrors the decisions staff already make elsewhere in RAR, so the vocabulary
// is the same one they use in Scout triage and price review.
const DECISION_STATUS: Record<string, string> = {
  mark_unsold: "unsold",
  wrong_edition: "inaccessible",
  mark_ambiguous: "ambiguous",
  dismiss: "review_complete",
};

/**
 * Every decision except confirm_sale, for one outcome.
 *
 * Extracted so the single-row buttons and the bulk bar run identical code:
 * the same guards, the same audit rows, the same refusal to overwrite a
 * decision someone has already made. A second bulk-only path would be a
 * second set of rules to keep in step, which is how the two drift apart.
 */
async function applyDecision(
  admin: ReturnType<typeof getSupabaseAdmin>,
  outcomeId: string,
  decision: string,
  reviewer: string,
  notes: string | null,
): Promise<DecisionResult> {
  const { data: outcome } = await admin
    .from("listing_outcomes")
    .select("id, status, reviewed_by, resulting_observation_id, check_attempts")
    .eq("id", outcomeId)
    .maybeSingle();
  if (!outcome) return { ok: false, error: "That listing outcome no longer exists.", httpStatus: 404 };
  if (outcome.resulting_observation_id) {
    return { ok: false, error: "This listing has already produced a sale. It was not changed.", httpStatus: 409 };
  }
  if (outcome.reviewed_by) {
    return { ok: false, error: `Already reviewed by ${outcome.reviewed_by}. It was not changed.`, httpStatus: 409 };
  }

  const now = new Date().toISOString();

  // Multi-quantity fixed-price listings may remain live after one or more
  // copies sell. A human can therefore return an uncertain outcome to active
  // monitoring without claiming that a sale did or did not happen.
  if (decision === "keep_watching") {
    if (!["active", "ended_pending_check", "ambiguous", "inaccessible"].includes(outcome.status)) {
      return { ok: false, error: "Only an uncertain or inaccessible listing can be returned to the watch queue.", httpStatus: 400 };
    }
    const nextAttempt = (outcome.check_attempts ?? 0) + 1;
    const detail = `Human ${reviewer} confirmed that this listing is still live and should remain watched.${notes ? ` Note: ${notes}` : ""}`;
    const { error: auditError } = await admin.from("listing_outcome_checks").insert({
      outcome_id: outcome.id,
      provider: "human review",
      attempt_number: nextAttempt,
      http_status: null,
      listing_state: "active",
      resulting_status: "active",
      detail,
      raw_response: { decision: "keep_watching", reviewed_by: reviewer, notes },
      checked_at: now,
    });
    if (auditError) return { ok: false, error: "The review audit could not be saved. Nothing was changed.", httpStatus: 500 };

    const { data: updated, error: updateError } = await admin.from("listing_outcomes").update({
      status: "active",
      last_seen_at: now,
      last_checked_at: now,
      next_check_at: null,
      last_error: null,
      outcome_reason: detail,
      outcome_provider: "human review",
      human_attention_snoozed_until: outcomeHumanSnoozedUntil(now),
      check_attempts: nextAttempt,
      updated_at: now,
    }).eq("id", outcome.id).eq("status", outcome.status).eq("check_attempts", outcome.check_attempts)
      .is("reviewed_by", null).is("resulting_observation_id", null).select("id").maybeSingle();
    if (updateError || !updated) return { ok: false, error: "The listing could not be returned to monitoring. The audit attempt remains visible.", httpStatus: 500 };
    return { ok: true, status: "active" };
  }

  if (decision === "mark_unsold" && outcome.status === "active") {
    return { ok: false, error: "A live listing cannot be marked unsold. Keep watching it or dismiss it for another reason.", httpStatus: 400 };
  }

  const status = DECISION_STATUS[decision];
  if (!status) return { ok: false, error: "Unknown decision.", httpStatus: 400 };
  const { data: updated, error } = await admin.from("listing_outcomes").update({
    status, reviewed_by: reviewer, reviewed_at: now, review_notes: notes,
    // A human has answered; stop spending API calls on it.
    next_check_at: null, updated_at: now,
  }).eq("id", outcome.id).eq("status", outcome.status).eq("check_attempts", outcome.check_attempts)
      .is("reviewed_by", null).is("resulting_observation_id", null).select("id").maybeSingle();
  if (error || !updated) return { ok: false, error: "This listing changed or the decision could not be saved. Refresh before retrying.", httpStatus: 500 };
  return { ok: true, status };
}

export async function POST(request: Request) {
  if (!await isStaffRequest(request)) {
    return Response.json({ error: "Staff access is required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as DecisionBody;
  const admin = getSupabaseAdmin();

  if (body.action === "probe") {
    return Response.json({ capabilities: await probeOutcomeProviders(await capabilitySample(admin)) });
  }

  if (body.action === "run") {
    const captured = await captureWatchedListings(admin);
    const promoted = await promoteEndedListings(admin);
    const checks = await runOutcomeChecks(admin);
    return Response.json({ captured, promoted, checks, capabilities: await probeOutcomeProviders(await capabilitySample(admin)) });
  }

  if (body.action === "test-ebay-user-access") {
    const { data: sample } = await admin
      .from("listing_outcomes")
      .select("external_id,marketplace")
      .order("last_seen_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sample) return Response.json({ error: "RAR has no watched eBay listing to use for this read-only test." }, { status: 404 });
    const result = await tradingOutcomeProvider(sample.external_id, sample.marketplace);
    if (result.signal.detail.includes("not configured")) {
      return Response.json({ error: result.signal.detail }, { status: 503 });
    }
    return Response.json({
      ok: result.httpStatus === 200,
      state: result.signal.listingState,
      detail: result.signal.detail,
      httpStatus: result.httpStatus,
    }, { status: result.httpStatus === 200 ? 200 : 502 });
  }

  const reviewer = (body.reviewer ?? "").trim();

  // ------------------------------------------------------------- bulk ----
  if (body.action === "bulk-decide") {
    if (!reviewer) return Response.json({ error: "Add your name or initials so the decision is attributable." }, { status: 400 });
    const ids = [...new Set((body.outcomeIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (!ids.length) return Response.json({ error: "Select at least one listing." }, { status: 400 });
    if (ids.length > BULK_LIMIT) return Response.json({ error: `Select at most ${BULK_LIMIT} listings at a time.` }, { status: 400 });
    if (!body.decision || !isBulkSafeDecision(body.decision)) {
      return Response.json({
        error: "That decision cannot be applied in bulk. Verifying a sale is done one listing at a time, so the exact edition can be checked.",
      }, { status: 400 });
    }
    const bulkNotes = (body.notes ?? "").trim() || null;
    const decision = body.decision;

    // Each row is applied independently: one failure never rolls back the
    // rest, and every failure is reported with its own reason so the ones
    // that did not save can stay selected.
    const saved: string[] = [];
    const failures: Array<{ outcomeId: string; error: string }> = [];
    for (let index = 0; index < ids.length; index += BULK_CONCURRENCY) {
      const chunk = ids.slice(index, index + BULK_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (id) => ({ id, result: await applyDecision(admin, id, decision, reviewer, bulkNotes) })));
      for (const { id, result } of results) {
        if (result.ok) saved.push(id);
        else failures.push({ outcomeId: id, error: result.error });
      }
    }
    return Response.json({ ok: failures.length === 0, saved: saved.length, savedIds: saved, failed: failures.length, failures });
  }

  if (!body.outcomeId || (!body.decision && !["record-best-offer-price", "record-observed-sale", "record-page-signal"].includes(body.action ?? ""))) return Response.json({ error: "An outcome and a decision are required." }, { status: 400 });
  if (!reviewer) return Response.json({ error: "Add your name or initials so the decision is attributable." }, { status: 400 });
  // Notes stay optional throughout RAR: the decision and the reviewer are the
  // accountable parts, and demanding prose on an obvious call only produces
  // filler.
  const notes = (body.notes ?? "").trim() || null;

  const { data: outcome } = await admin
    .from("listing_outcomes")
    .select("id, status, edition_id, source_id, external_id, source_listing_url, listing_title, sold_price, sold_currency, sold_at, buying_format, original_snapshot, resulting_observation_id, reviewed_by, check_attempts, outcome_provider, outcome_reason, last_seen_at")
    .eq("id", body.outcomeId)
    .maybeSingle();
  if (!outcome) return Response.json({ error: "That listing outcome no longer exists." }, { status: 404 });
  if (outcome.resulting_observation_id) {
    return Response.json({ error: "This listing has already produced a sale. It was not changed." }, { status: 409 });
  }
  // A previous human decision is never overwritten by another action here.
  if (outcome.reviewed_by) {
    return Response.json({ error: `Already reviewed by ${outcome.reviewed_by}. It was not changed.` }, { status: 409 });
  }

  const now = new Date().toISOString();

  if (body.action === "record-page-signal") {
    if (!body.pageSignal || !["green_sold", "red_ended", "still_live", "unclear"].includes(body.pageSignal)) {
      return Response.json({ error: "Choose what the original eBay page visibly shows." }, { status: 400 });
    }
    if (["sold_candidate", "unsold", "review_complete"].includes(outcome.status)) {
      return Response.json({ error: "This outcome is already resolved or ready for sale review." }, { status: 409 });
    }

    const pageEvidence = classifyStaffPageSignal(body.pageSignal);
    const nextAttempt = (outcome.check_attempts ?? 0) + 1;
    const detail = `${pageEvidence.detail} Observed by ${reviewer}.`;
    const { error: auditError } = await admin.from("listing_outcome_checks").insert({
      outcome_id: outcome.id,
      provider: "eBay page — staff observed",
      attempt_number: nextAttempt,
      http_status: null,
      listing_state: pageEvidence.listingState,
      resulting_status: pageEvidence.resultingStatus,
      detail,
      raw_response: {
        page_signal: body.pageSignal,
        colour_and_adjacent_wording_confirmed: body.pageSignal === "green_sold" || body.pageSignal === "red_ended",
        reviewed_by: reviewer,
      },
      checked_at: now,
    });
    if (auditError) return Response.json({ error: "The page observation could not be audited. Nothing was changed." }, { status: 500 });

    const resolvedUnsold = body.pageSignal === "red_ended";
    const { data: updated, error: updateError } = await admin.from("listing_outcomes").update({
      status: pageEvidence.resultingStatus,
      outcome_reason: detail,
      outcome_provider: "eBay page — staff observed",
      check_attempts: nextAttempt,
      last_checked_at: now,
      last_seen_at: body.pageSignal === "still_live" ? now : outcome.last_seen_at,
      next_check_at: null,
      last_error: null,
      reviewed_by: resolvedUnsold ? reviewer : null,
      reviewed_at: resolvedUnsold ? now : null,
      review_notes: resolvedUnsold ? detail : null,
      human_attention_snoozed_until: body.pageSignal === "still_live" ? outcomeHumanSnoozedUntil(now) : null,
      updated_at: now,
    }).eq("id", outcome.id).eq("status", outcome.status).eq("check_attempts", outcome.check_attempts)
      .is("reviewed_by", null).is("resulting_observation_id", null).select("id").maybeSingle();
    if (updateError || !updated) return Response.json({ error: "The page observation could not be applied. Its audit record remains visible." }, { status: 500 });
    return Response.json({ ok: true, status: pageEvidence.resultingStatus, outcomeConfidence: body.pageSignal === "green_sold" ? 85 : body.pageSignal === "red_ended" || body.pageSignal === "still_live" ? 95 : 30 });
  }

  // ------------------------------------------- staff-observed sale price ----
  // The gap this closes: an ordinary auction or fixed-price listing that
  // plainly sold, with the price printed on the page, but which eBay's API
  // would not report. eBay's original sold page is the source; a visible Buyer
  // Protection fee is captured separately and removed from the chart price.
  if (body.action === "record-observed-sale") {
    if (outcomeIsBestOffer(outcome.buying_format, outcome.listing_title)) {
      return Response.json({ error: "Use the accepted Best Offer price check for this listing; its advertised price cannot be used." }, { status: 400 });
    }
    const alreadyPriced = Boolean(outcome.sold_price && outcome.sold_currency && outcome.sold_at);
    if (outcome.status === "sold_candidate" && alreadyPriced) {
      return Response.json({ error: "This candidate already has a price and date. Verify it against the edition instead." }, { status: 409 });
    }
    if (["unsold", "review_complete"].includes(outcome.status)) {
      return Response.json({ error: "This outcome is already resolved. It was not changed." }, { status: 409 });
    }

    const displayedTotal = Number(body.displayedTotal ?? body.soldPrice);
    const buyerProtectionFee = Number(body.buyerProtectionFee ?? 0);
    const soldCurrency = (body.soldCurrency ?? "").trim().toUpperCase();
    const soldAt = (body.soldAt ?? "").trim();
    const validationError = validateEbayDisplayedSaleEvidence({ displayedTotal, buyerProtectionFee, soldCurrency, soldAt });
    if (validationError) return Response.json({ error: validationError }, { status: 400 });
    const soldPrice = ebayItemPrice(displayedTotal, buyerProtectionFee);
    if (soldPrice === null) return Response.json({ error: "RAR could not calculate the item price from the eBay total and fee." }, { status: 400 });

    // The audit row says who looked and what RAR had thought, so a later reader
    // can see this was a human overruling the pipeline rather than the
    // pipeline having worked.
    const detail = `Human ${reviewer} opened eBay item ${outcome.external_id} and recorded the completed sale shown on the page. The displayed total was ${soldCurrency} ${displayedTotal.toFixed(2)}${buyerProtectionFee ? ` including a ${soldCurrency} ${buyerProtectionFee.toFixed(2)} Buyer Protection fee` : " with no separate Buyer Protection fee shown"}; RAR stored the ${soldCurrency} ${soldPrice.toFixed(2)} item price. RAR had this listing as "${outcome.status.replaceAll("_", " ")}".${notes ? ` Note: ${notes}` : ""}`;
    const nextAttempt = (outcome.check_attempts ?? 0) + 1;
    const { error: auditError } = await admin.from("listing_outcome_checks").insert({
      outcome_id: outcome.id,
      provider: "eBay page — staff observed sale",
      attempt_number: nextAttempt,
      http_status: null,
      listing_state: "completed_sold",
      resulting_status: "sold_candidate",
      detail,
      raw_response: {
        ebay_item_id: outcome.external_id,
        source_listing_url: outcome.source_listing_url,
        displayed_total: displayedTotal,
        buyer_protection_fee: buyerProtectionFee,
        item_price_excluding_buyer_fee: soldPrice,
        currency: soldCurrency,
        sold_at: soldAt,
        previous_status: outcome.status,
        reviewed_by: reviewer,
      },
      checked_at: now,
    });
    if (auditError) return Response.json({ error: "The observation could not be audited. Nothing was changed." }, { status: 500 });

    // Deliberately stops at sold_candidate. Recording what the page showed and
    // deciding it is the exact RAR edition are two different judgements, and
    // collapsing them into one button is how a wrong-edition sale reaches a
    // chart.
    const { data: updated, error: updateError } = await admin.from("listing_outcomes").update({
      status: "sold_candidate",
      sold_price: soldPrice,
      sold_currency: soldCurrency,
      sold_at: soldAt,
      outcome_reason: detail,
      outcome_provider: "eBay page — staff observed sale",
      check_attempts: nextAttempt,
      last_checked_at: now,
      next_check_at: null,
      last_error: null,
      updated_at: now,
    }).eq("id", outcome.id).eq("status", outcome.status).eq("check_attempts", outcome.check_attempts)
      .is("reviewed_by", null).is("resulting_observation_id", null).select("id").maybeSingle();
    if (updateError || !updated) return Response.json({ error: "The observed sale could not be saved. Its audit record remains visible." }, { status: 500 });
    return Response.json({ ok: true, status: "sold_candidate" });
  }

  if (body.action === "record-best-offer-price") {
    if (!["ended_pending_check", "ambiguous", "inaccessible", "sold_candidate"].includes(outcome.status)
      || (outcome.status === "sold_candidate" && outcome.sold_price && outcome.sold_currency && outcome.sold_at)) {
      return Response.json({ error: "Only an ended Best Offer with an unresolved outcome can use this check." }, { status: 400 });
    }
    const displayedTotal = Number(body.displayedTotal ?? body.soldPrice);
    const buyerProtectionFee = Number(body.buyerProtectionFee ?? 0);
    const soldCurrency = (body.soldCurrency ?? "").trim().toUpperCase();
    const soldAt = (body.soldAt ?? "").trim();
    const displayedValidationError = validateEbayDisplayedSaleEvidence({ displayedTotal, buyerProtectionFee, soldCurrency, soldAt });
    if (displayedValidationError) return Response.json({ error: displayedValidationError }, { status: 400 });
    const soldPrice = ebayItemPrice(displayedTotal, buyerProtectionFee);
    if (soldPrice === null) return Response.json({ error: "RAR could not calculate the item price from the eBay total and fee." }, { status: 400 });
    const validationError = validateManualBestOfferEvidence({ buyingFormat: outcomeIsBestOffer(outcome.buying_format, outcome.listing_title) ? "BEST_OFFER" : outcome.buying_format, soldPrice, soldCurrency, soldAt });
    if (validationError) return Response.json({ error: validationError }, { status: 400 });

    const detail = `Human ${reviewer} opened eBay item ${outcome.external_id} and recorded the accepted Best Offer price now disclosed on the original sold page. The displayed total was ${soldCurrency} ${displayedTotal.toFixed(2)}${buyerProtectionFee ? ` including a ${soldCurrency} ${buyerProtectionFee.toFixed(2)} Buyer Protection fee` : " with no separate Buyer Protection fee shown"}; RAR stored the ${soldCurrency} ${soldPrice.toFixed(2)} item price.${notes ? ` Note: ${notes}` : ""}`;
    const nextAttempt = (outcome.check_attempts ?? 0) + 1;
    const { error: auditError } = await admin.from("listing_outcome_checks").insert({
      outcome_id: outcome.id,
      provider: "eBay sold page — staff observed accepted price",
      attempt_number: nextAttempt,
      http_status: null,
      listing_state: "completed_sold",
      resulting_status: "sold_candidate",
      detail,
      raw_response: { source_listing_url: outcome.source_listing_url, ebay_item_id: outcome.external_id, displayed_total: displayedTotal, buyer_protection_fee: buyerProtectionFee, item_price_excluding_buyer_fee: soldPrice, currency: soldCurrency, sold_at: soldAt, reviewed_by: reviewer },
      checked_at: now,
    });
    if (auditError) return Response.json({ error: "The corroboration audit record could not be saved. Nothing was changed." }, { status: 500 });

    const { data: updated, error: updateError } = await admin.from("listing_outcomes").update({
      status: "sold_candidate",
      sold_price: soldPrice,
      sold_currency: soldCurrency,
      sold_at: soldAt,
      outcome_reason: detail,
      outcome_provider: "eBay sold page — staff observed accepted price",
      check_attempts: nextAttempt,
      last_checked_at: now,
      next_check_at: null,
      last_error: null,
      updated_at: now,
    }).eq("id", outcome.id).eq("status", outcome.status).eq("check_attempts", outcome.check_attempts)
      .is("reviewed_by", null).is("resulting_observation_id", null).select("id").maybeSingle();
    if (updateError || !updated) return Response.json({ error: "The accepted price could not be saved. The audit attempt remains visible." }, { status: 500 });
    return Response.json({ ok: true, status: "sold_candidate" });
  }

  if (!body.decision) return Response.json({ error: "A decision is required." }, { status: 400 });

  // Every decision but confirm_sale runs through the same function the bulk
  // bar uses, so a single click and a batch of forty cannot diverge.
  if (body.decision !== "confirm_sale") {
    const result = await applyDecision(admin, outcome.id, body.decision, reviewer, notes);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.httpStatus });
    return Response.json({ ok: true, status: result.status });
  }

  try {
    const result = await confirmOutcomeSale(admin, outcome, body, reviewer, notes);
    try { await snapshotHoldersOfEdition(admin, outcome.edition_id); } catch { /* The audited sale is already committed. */ }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The sale could not be saved. Refresh and retry." }, { status: 409 });
  }
}
