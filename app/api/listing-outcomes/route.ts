import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { captureWatchedListings, promoteEndedListings, runOutcomeChecks } from "@/lib/watchToSale";
import { probeOutcomeProviders, tradingOutcomeProvider } from "@/lib/listingOutcomeProviders";
import { validateManualBestOfferEvidence } from "@/lib/listingOutcome";
import { isBulkSafeDecision } from "@/lib/listingOutcomeDecisions";
import { classifyStaffPageSignal, type StaffPageSignal } from "@/lib/listingPageEvidence";

// Watch-to-Sale staff endpoint.
//
// Two jobs: run the pipeline (capture, promote, check), and record a human
// decision about a sold candidate. Everything that could create evidence goes
// through the decision path, and only ever on an explicit staff action.

export const dynamic = "force-dynamic";

type DecisionBody = {
  action?: string;
  outcomeId?: string;
  outcomeIds?: string[];
  decision?: "confirm_sale" | "keep_watching" | "mark_unsold" | "wrong_edition" | "mark_ambiguous" | "dismiss";
  reviewer?: string;
  notes?: string;
  soldPrice?: number;
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
  if (outcome.status === "review_complete" && outcome.reviewed_by) {
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

    const { error: updateError } = await admin.from("listing_outcomes").update({
      status: "active",
      last_seen_at: now,
      last_checked_at: now,
      next_check_at: null,
      last_error: null,
      outcome_reason: detail,
      outcome_provider: "human review",
      check_attempts: nextAttempt,
      updated_at: now,
    }).eq("id", outcome.id);
    if (updateError) return { ok: false, error: "The listing could not be returned to monitoring. The audit attempt remains visible.", httpStatus: 500 };
    return { ok: true, status: "active" };
  }

  if (decision === "mark_unsold" && outcome.status === "active") {
    return { ok: false, error: "A live listing cannot be marked unsold. Keep watching it or dismiss it for another reason.", httpStatus: 400 };
  }

  const status = DECISION_STATUS[decision];
  if (!status) return { ok: false, error: "Unknown decision.", httpStatus: 400 };
  const { error } = await admin.from("listing_outcomes").update({
    status, reviewed_by: reviewer, reviewed_at: now, review_notes: notes,
    // A human has answered; stop spending API calls on it.
    next_check_at: null, updated_at: now,
  }).eq("id", outcome.id);
  if (error) return { ok: false, error: "The decision could not be saved.", httpStatus: 500 };
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

  if (!body.outcomeId || (!body.decision && !["record-best-offer-price", "record-page-signal"].includes(body.action ?? ""))) return Response.json({ error: "An outcome and a decision are required." }, { status: 400 });
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
  if (outcome.status === "review_complete" && outcome.reviewed_by) {
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
    const { error: updateError } = await admin.from("listing_outcomes").update({
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
      updated_at: now,
    }).eq("id", outcome.id);
    if (updateError) return Response.json({ error: "The page observation could not be applied. Its audit record remains visible." }, { status: 500 });
    return Response.json({ ok: true, status: pageEvidence.resultingStatus, outcomeConfidence: body.pageSignal === "green_sold" ? 85 : body.pageSignal === "red_ended" || body.pageSignal === "still_live" ? 95 : 30 });
  }

  if (body.action === "record-best-offer-price") {
    if (!["ended_pending_check", "ambiguous", "inaccessible"].includes(outcome.status)) {
      return Response.json({ error: "Only an ended Best Offer with an unresolved outcome can use this check." }, { status: 400 });
    }
    const soldPrice = Number(body.soldPrice);
    const soldCurrency = (body.soldCurrency ?? "").trim().toUpperCase();
    const soldAt = (body.soldAt ?? "").trim();
    const validationError = validateManualBestOfferEvidence({ buyingFormat: outcome.buying_format, soldPrice, soldCurrency, soldAt });
    if (validationError) return Response.json({ error: validationError }, { status: 400 });

    const detail = `Human ${reviewer} matched eBay item ${outcome.external_id} on 130point and recorded the accepted Best Offer price. 130point corroborates the hidden price; the original sale source remains eBay.${notes ? ` Note: ${notes}` : ""}`;
    const nextAttempt = (outcome.check_attempts ?? 0) + 1;
    const { error: auditError } = await admin.from("listing_outcome_checks").insert({
      outcome_id: outcome.id,
      provider: "130point manual corroboration",
      attempt_number: nextAttempt,
      http_status: null,
      listing_state: "completed_sold",
      resulting_status: "sold_candidate",
      detail,
      raw_response: { lookup_url: "https://130point.com/sales/", ebay_item_id: outcome.external_id, accepted_price: soldPrice, currency: soldCurrency, sold_at: soldAt, reviewed_by: reviewer },
      checked_at: now,
    });
    if (auditError) return Response.json({ error: "The corroboration audit record could not be saved. Nothing was changed." }, { status: 500 });

    const { error: updateError } = await admin.from("listing_outcomes").update({
      status: "sold_candidate",
      sold_price: soldPrice,
      sold_currency: soldCurrency,
      sold_at: soldAt,
      outcome_reason: detail,
      outcome_provider: "130point manual corroboration",
      check_attempts: nextAttempt,
      last_checked_at: now,
      next_check_at: null,
      last_error: null,
      updated_at: now,
    }).eq("id", outcome.id);
    if (updateError) return Response.json({ error: "The accepted price could not be saved. The audit attempt remains visible." }, { status: 500 });
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

  // ---------------------------------------------------------- confirm ----
  // The one deliberate action that turns a watched listing into evidence.
  // It reuses the existing price-observation and price-review workflow rather
  // than inventing a second one, and it completes in a single step: staff do
  // not approve the same evidence again on the review page.
  if (outcome.status !== "sold_candidate") {
    return Response.json({ error: "Only a sold candidate can be confirmed as a sale." }, { status: 400 });
  }
  if (!outcome.sold_price || !outcome.sold_currency || !outcome.sold_at) {
    return Response.json({ error: "This candidate has no confirmed price and date, so it cannot become a sale." }, { status: 400 });
  }

  // The same guard add-sale uses: one marketplace listing, one sale, ever.
  const { data: duplicate } = await admin
    .from("price_observations")
    .select("id")
    .eq("source_id", outcome.source_id)
    .eq("external_id", outcome.external_id)
    .maybeSingle();
  if (duplicate) {
    await admin.from("listing_outcomes").update({
      status: "review_complete", resulting_observation_id: duplicate.id,
      reviewed_by: reviewer, reviewed_at: now, review_notes: notes, next_check_at: null, updated_at: now,
    }).eq("id", outcome.id);
    return Response.json({ error: "That marketplace listing already exists as a sale in RAR. The outcome was linked to it and nothing was duplicated." }, { status: 409 });
  }

  const { data: observation, error: insertError } = await admin.from("price_observations").insert({
    edition_id: outcome.edition_id,
    source_id: outcome.source_id,
    source_listing_url: outcome.source_listing_url,
    external_id: outcome.external_id,
    listing_title: outcome.listing_title,
    sold_date: outcome.sold_at,
    sale_price: outcome.sold_price,
    currency: outcome.sold_currency,
    sale_type: outcome.buying_format?.includes("AUCTION") ? "auction" : "fixed_price",
    // Raw versus graded is never inferred here. The observation lands with no
    // grading company, which is RAR's "raw" position, and a graded sale is
    // recorded by a human on the sale record exactly as it always has been.
    raw_payload: {
      ...(outcome.original_snapshot ?? {}),
      rar_outcome_evidence: {
        provider: outcome.outcome_provider,
        reason: outcome.outcome_reason,
      },
    },
    is_verified: false,
    match_status: "needs_review",
    sale_status: "confirmed",
    notes,
  }).select("id").maybeSingle();

  if (insertError?.code === "23505" || (!observation && !insertError)) {
    return Response.json({ error: "That marketplace listing already exists as a sale in RAR. It was not changed." }, { status: 409 });
  }
  if (insertError || !observation) {
    return Response.json({ error: "The sale could not be created. Nothing was verified." }, { status: 500 });
  }

  // Verified in the same action, through the same function the review queue
  // uses, so the audit trail is identical to a sale approved by hand.
  const { error: reviewError } = await admin.rpc("apply_price_review", {
    p_observation_id: observation.id,
    p_decision: "verified_match",
    p_decision_notes: notes ?? `Confirmed from watched eBay listing ${outcome.external_id}.`,
    p_reviewed_by: reviewer,
  });
  if (reviewError) {
    return Response.json({
      error: "The sale was created but could not be verified. It is in the review queue and has not reached any chart.",
      observationId: observation.id,
    }, { status: 500 });
  }

  await admin.from("listing_outcomes").update({
    status: "review_complete",
    resulting_observation_id: observation.id,
    reviewed_by: reviewer,
    reviewed_at: now,
    review_notes: notes,
    next_check_at: null,
    updated_at: now,
  }).eq("id", outcome.id);

  return Response.json({ ok: true, status: "review_complete", observationId: observation.id });
}
