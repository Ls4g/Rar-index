import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyListingOutcome,
  exhaustedOutcome,
  isDueForCheck,
  MAX_OUTCOME_ATTEMPTS,
  nextOutcomeCheckAt,
  type OutcomeStatus,
} from "./listingOutcome.ts";
import { resolveListingOutcome } from "./listingOutcomeProviders.ts";
import { ebayMarketplaceFromUrl } from "./ebayEvidence.ts";

export type WatchCaptureResult = { captured: number; updated: number; skipped: number };
export type OutcomeCheckResult = {
  due: number;
  checked: number;
  soldCandidates: number;
  unsold: number;
  ambiguous: number;
  inaccessible: number;
  stillActive: number;
  exhausted: number;
  errors: string[];
};

// A daily batch of 40 could not keep pace with the live queue: the job was
// healthy, but hundreds of due rows accumulated. This remains deliberately
// bounded so one run cannot fan out without limit or surprise the eBay quota.
export const DEFAULT_OUTCOME_CHECK_LIMIT = 160;
export const OUTCOME_CHECK_CONCURRENCY = 6;

type LeadRow = {
  id: string;
  profile_id: string;
  source_id: string;
  external_id: string;
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  item_end_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  raw_payload: unknown;
  match_assessment: unknown;
};

function readItem(payload: unknown) {
  return (payload as { item?: Record<string, unknown> } | null)?.item ?? {};
}

// Watch every live lead Scout has captured for an edition. Deliberately
// separate storage from scout_listing_leads: that table caps itself at 20
// unreviewed leads per profile and deletes the surplus, and a watched listing
// has to outlive exactly that in order to still be here when the listing ends.
export async function captureWatchedListings(admin: SupabaseClient, limit = 500): Promise<WatchCaptureResult> {
  const { data: profileData } = await admin
    .from("marketplace_search_profiles")
    .select("id, edition_id")
    .eq("is_active", true);
  const editionByProfile = new Map((profileData ?? []).map((row) => [row.id as string, row.edition_id as string]));
  if (!editionByProfile.size) return { captured: 0, updated: 0, skipped: 0 };

  const { data: leadData } = await admin
    .from("scout_listing_leads")
    .select("id,profile_id,source_id,external_id,source_listing_url,listing_title,listing_price,currency,item_end_at,first_seen_at,last_seen_at,raw_payload,match_assessment")
    .in("profile_id", [...editionByProfile.keys()])
    .neq("review_status", "dismissed")
    .limit(limit);

  const leads = (leadData ?? []) as LeadRow[];
  const result: WatchCaptureResult = { captured: 0, updated: 0, skipped: 0 };

  for (const lead of leads) {
    const editionId = editionByProfile.get(lead.profile_id);
    if (!editionId) { result.skipped += 1; continue; }
    const item = readItem(lead.raw_payload);
    const marketplace = ebayMarketplaceFromUrl(lead.source_listing_url) ?? process.env.EBAY_MARKETPLACE_ID ?? "EBAY_GB";

    const row = {
      source_id: lead.source_id,
      external_id: lead.external_id,
      marketplace,
      source_listing_url: lead.source_listing_url,
      profile_id: lead.profile_id,
      edition_id: editionId,
      listing_title: lead.listing_title,
      image_url: (item.image as { imageUrl?: string } | undefined)?.imageUrl ?? null,
      asking_price: lead.listing_price,
      currency: lead.currency,
      buying_format: Array.isArray(item.buyingOptions) ? (item.buyingOptions as string[]).join(",") : null,
      bid_count: typeof item.bidCount === "number" ? (item.bidCount as number) : null,
      scheduled_end_at: lead.item_end_at,
      first_seen_at: lead.first_seen_at,
      last_seen_at: lead.last_seen_at,
      // Frozen here on purpose. eBay will stop serving this listing, and a
      // reviewer weeks later still needs to see what was on offer.
      original_snapshot: (lead.raw_payload ?? {}) as Record<string, unknown>,
      match_assessment: (lead.match_assessment ?? {}) as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    };

    // ignoreDuplicates keeps the original snapshot and any human decision
    // intact: a listing already being watched is never rewritten by a later
    // sighting of the same listing.
    const { data: inserted, error } = await admin
      .from("listing_outcomes")
      .upsert(row, { onConflict: "marketplace,external_id", ignoreDuplicates: true })
      .select("id");
    if (error) { result.skipped += 1; continue; }
    if (inserted?.length) result.captured += 1;
    else {
      await admin.from("listing_outcomes")
        .update({ last_seen_at: lead.last_seen_at, updated_at: new Date().toISOString() })
        .eq("marketplace", marketplace)
        .eq("external_id", lead.external_id)
        // Never disturb a row a human has finished with.
        .in("status", ["active", "ended_pending_check"]);
      result.updated += 1;
    }
  }
  return result;
}

// A fixed-price listing has no end date at all -- eBay only publishes one for
// auctions -- and the first live run showed every captured listing with a null
// end time. Left alone those would sit as "active" for ever and never be
// checked, which would quietly make the pipeline do nothing.
//
// So a listing RAR has not seen in a scan for this long is queued for a status
// check. It is NOT described as ended: a fixed-price listing can remain live
// even when it falls out of one Scout result page.
export const UNSEEN_DAYS_BEFORE_CHECK = 7;

// Move listings into the status-check queue. A passed eBay end time is useful
// evidence that the listing ended; merely going unseen is only a scheduling
// signal. They share the legacy ended_pending_check DB state for compatibility,
// but carry different, truthful reasons for staff and confidence scoring.
export async function promoteEndedListings(admin: SupabaseClient) {
  const now = new Date().toISOString();
  const unseenBefore = new Date(Date.now() - UNSEEN_DAYS_BEFORE_CHECK * 86_400_000).toISOString();
  const { data: explicitlyEnded } = await admin
    .from("listing_outcomes")
    .update({
      status: "ended_pending_check",
      next_check_at: nextOutcomeCheckAt(0),
      outcome_reason: "eBay supplied an end time that has passed. The sale outcome still needs checking.",
      outcome_provider: "RAR scheduler",
      updated_at: now,
    })
    .eq("status", "active")
    .not("scheduled_end_at", "is", null)
    .lt("scheduled_end_at", now)
    .select("id");

  const { data: unseen } = await admin
    .from("listing_outcomes")
    .update({
      status: "ended_pending_check",
      next_check_at: nextOutcomeCheckAt(0),
      outcome_reason: "RAR has not seen this listing in a recent Scout scan. Its live status needs checking; this does not prove it ended.",
      outcome_provider: "RAR scheduler",
      updated_at: now,
    })
    .eq("status", "active")
    .is("scheduled_end_at", null)
    .lt("last_seen_at", unseenBefore)
    .select("id");

  return (explicitlyEnded?.length ?? 0) + (unseen?.length ?? 0);
}

export async function runOutcomeChecks(admin: SupabaseClient, limit = DEFAULT_OUTCOME_CHECK_LIMIT): Promise<OutcomeCheckResult> {
  const result: OutcomeCheckResult = { due: 0, checked: 0, soldCandidates: 0, unsold: 0, ambiguous: 0, inaccessible: 0, stillActive: 0, exhausted: 0, errors: [] };
  const nowIso = new Date().toISOString();

  const { data } = await admin
    .from("listing_outcomes")
    .select("id, external_id, marketplace, listing_title, status, scheduled_end_at, next_check_at, check_attempts, outcome_provider")
    .in("status", ["ended_pending_check", "ambiguous"])
    .or(`next_check_at.is.null,next_check_at.lte.${nowIso}`)
    .order("next_check_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const rows = (data ?? []) as Array<{
    id: string; external_id: string; marketplace: string; listing_title: string;
    status: OutcomeStatus; scheduled_end_at: string | null; next_check_at: string | null; check_attempts: number; outcome_provider: string | null;
  }>;
  // A staff observation is stronger than another automatic retry. Preserve it
  // until staff either supplies the missing sale details or dismisses it.
  const due = rows.filter((row) => row.outcome_provider !== "eBay page — staff observed" && isDueForCheck(row));
  result.due = due.length;

  for (let index = 0; index < due.length; index += OUTCOME_CHECK_CONCURRENCY) {
    const chunk = due.slice(index, index + OUTCOME_CHECK_CONCURRENCY);
    await Promise.all(chunk.map(async (row) => {
    const attempt = row.check_attempts + 1;
    let providerResult;
    try {
      providerResult = await resolveListingOutcome(row.external_id, row.marketplace, row.listing_title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "outcome provider failed";
      result.errors.push(`${row.external_id}: ${message}`);
      await admin.from("listing_outcome_checks").insert({
        outcome_id: row.id, provider: "unavailable", attempt_number: attempt,
        listing_state: "unknown", resulting_status: row.status, detail: message,
      });
      // A transient failure must not consume the listing's retries or push it
      // toward a conclusion. It stays where it is and comes round again.
      await admin.from("listing_outcomes").update({
        last_checked_at: nowIso, last_error: message,
        next_check_at: nextOutcomeCheckAt(Math.max(0, attempt - 1)), updated_at: nowIso,
      }).eq("id", row.id);
      return;
    }

    const classification = classifyListingOutcome(providerResult.signal);
    const exhausted = !classification.resolved && attempt >= MAX_OUTCOME_ATTEMPTS;
    const final = exhausted ? exhaustedOutcome(providerResult.signal.provider, attempt) : classification;
    const providerTrail = providerResult.attempts ?? [];
    const auditDetail = providerTrail.length > 1
      ? `${final.reason} Provider path: ${providerTrail.map((item) => `${item.provider}=${item.listingState}${item.detail ? ` (${item.detail})` : ""}`).join(" -> ")}`
      : final.reason;

    await admin.from("listing_outcome_checks").insert({
      outcome_id: row.id,
      provider: providerResult.signal.provider,
      attempt_number: attempt,
      http_status: providerResult.httpStatus,
      listing_state: providerResult.signal.listingState,
      resulting_status: final.status,
      detail: auditDetail,
      raw_response: (providerTrail.length
        ? { final_response: providerResult.rawResponse ?? null, provider_attempts: providerTrail }
        : providerResult.rawResponse ?? null) as Record<string, unknown> | null,
    });

    // Never overwrite a human. If someone reviewed this row while the check
    // was in flight, their decision stands and the check is recorded only.
    const { error: updateError } = await admin.from("listing_outcomes").update({
      status: final.status,
      sold_price: final.soldPrice,
      sold_currency: final.soldCurrency,
      sold_at: final.soldAt,
      outcome_reason: final.reason,
      outcome_provider: providerResult.signal.provider,
      check_attempts: attempt,
      last_checked_at: nowIso,
      last_error: null,
      next_check_at: final.resolved || exhausted ? null : nextOutcomeCheckAt(attempt),
      updated_at: nowIso,
    }).eq("id", row.id).in("status", ["ended_pending_check", "ambiguous", "active"]);
    if (updateError) { result.errors.push(`${row.external_id}: ${updateError.message}`); return; }

    result.checked += 1;
    if (exhausted) result.exhausted += 1;
    if (final.status === "sold_candidate") result.soldCandidates += 1;
    else if (final.status === "unsold") result.unsold += 1;
    else if (final.status === "inaccessible") result.inaccessible += 1;
    else if (final.status === "ambiguous") result.ambiguous += 1;
    else if (final.status === "active") result.stillActive += 1;
    }));
  }

  return result;
}

export async function readWatchToSaleMetrics(admin: SupabaseClient) {
  const nowIso = new Date().toISOString();
  const byStatus = async (status: OutcomeStatus) => {
    const { count } = await admin.from("listing_outcomes").select("id", { count: "exact", head: true }).eq("status", status);
    return count ?? 0;
  };

  const [watching, soldCandidates, confirmed, unsold, ambiguous, inaccessible] = await Promise.all([
    byStatus("active"), byStatus("sold_candidate"), byStatus("review_complete"),
    byStatus("unsold"), byStatus("ambiguous"), byStatus("inaccessible"),
  ]);
  const { count: awaitingEndCount } = await admin.from("listing_outcomes")
    .select("id", { count: "exact", head: true }).eq("status", "active").gt("scheduled_end_at", nowIso);
  const { count: dueNowCount } = await admin.from("listing_outcomes")
    .select("id", { count: "exact", head: true }).eq("status", "ended_pending_check").lte("next_check_at", nowIso);
  const awaitingEnd = awaitingEndCount ?? 0;
  const dueNow = dueNowCount ?? 0;

  const { data: nextDue } = await admin
    .from("listing_outcomes")
    .select("next_check_at")
    .not("next_check_at", "is", null)
    .in("status", ["ended_pending_check", "ambiguous"])
    .order("next_check_at", { ascending: true })
    .limit(1);
  const { count: failing } = await admin
    .from("listing_outcomes")
    .select("id", { count: "exact", head: true })
    .not("last_error", "is", null);

  return {
    watch_listings_active: watching,
    watch_awaiting_end: awaitingEnd,
    watch_checks_due: dueNow,
    watch_sold_candidates: soldCandidates,
    watch_confirmed_sales: confirmed,
    watch_unsold: unsold,
    watch_ambiguous: ambiguous,
    watch_inaccessible: inaccessible,
    watch_api_failures: failing ?? 0,
    watch_next_check_at: nextDue?.[0]?.next_check_at ?? null,
  };
}
