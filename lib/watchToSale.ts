import type { SupabaseClient } from "@supabase/supabase-js";
import {
  classifyListingOutcome,
  exhaustedOutcome,
  isDueForCheck,
  MAX_OUTCOME_ATTEMPTS,
  nextOutcomeCheckAt,
  SOLD_SEARCH_DISCOVERY_PROVIDER,
  STILL_LIVE_RECHECK_DAYS,
  stillLiveFollowUp,
  type OutcomeStatus,
} from "./listingOutcome.ts";
import { resolveListingOutcome } from "./listingOutcomeProviders.ts";
import { ebayMarketplaceFromUrl } from "./ebayEvidence.ts";

export type WatchCaptureResult = { captured: number; updated: number; skipped: number; leadsRead?: number; truncated?: boolean };
export type OutcomeCheckResult = {
  due: number;
  checked: number;
  soldCandidates: number;
  unsold: number;
  ambiguous: number;
  inaccessible: number;
  stillActive: number;
  exhausted: number;
  /** Claimed from the slow still-live lane, after every first-priority row. */
  stillLiveRechecks: number;
  /** Still live after MAX_WATCH_DAYS of watching, so recorded as unknown. */
  watchExpired: number;
  errors: string[];
  /** Recorded checks and shared reservations. Unknown accounting stops work. */
  dailySpent: number | null;
  dailyRemaining: number | null;
  dailyReserved: number | null;
  budgetUnavailable: boolean;
  ceilingReached: boolean;
};

// A daily batch of 40 could not keep pace with the live queue: the job was
// healthy, but hundreds of due rows accumulated. This remains deliberately
// bounded so one run cannot fan out without limit or surprise the eBay quota.
export const DEFAULT_OUTCOME_CHECK_LIMIT = 600;
/* A per-run bound is not enough on its own. /api/listing-outcomes runs a batch
   on staff action as well as the daily cron, so 11 September reached 1,573
   checks at a limit of 160 -- about ten runs. Raising the limit without a
   daily ceiling would turn that same day into roughly 4,000 calls, 80% of the
   documented budget, in one afternoon. Shared database reservations include
   in-flight runs; unused slots are released only after a run stops. This
   limits outcome resolutions, not total HTTP calls across eBay consumers. */
export const DAILY_OUTCOME_CHECK_CEILING = 2500;
export const OUTCOME_CHECK_CONCURRENCY = 6;

// An exhausted ambiguous listing has no next check. Those rows used to sort
// ahead of every due listing and fill the 600-row batch before the in-memory
// due guard ran. A null date is due only for an unattempted pending check.
export function outcomeCheckQueueFilter(nowIso: string) {
  return `and(status.eq.ended_pending_check,next_check_at.is.null),next_check_at.lte.${nowIso}`;
}

// The second, slower lane: listings a provider last reported still for sale,
// due for their STILL_LIVE_RECHECK_DAYS recheck. Only ever claimed with the
// capacity the first lane left unused, so a backlog of long-lived listings can
// never delay the first check of a listing that has just ended.
export function stillLiveRecheckQueueFilter(nowIso: string) {
  return `next_check_at.lte.${nowIso}`;
}

const OUTCOME_QUEUE_COLUMNS = "id, external_id, marketplace, listing_title, status, scheduled_end_at, next_check_at, check_attempts, outcome_provider, buying_format, first_seen_at";

// PostgREST returns at most 1,000 rows whatever the limit says; reading one
// unordered page of 500 meant some watched leads were never captured at all.
export const CAPTURE_PAGE_SIZE = 1000;
// Bounds a single run (40,000 leads) so a runaway table cannot hold the cron
// past its time limit; leads beyond it are reported, not silently dropped.
export const CAPTURE_MAX_PAGES = 40;
const CAPTURE_UPSERT_CHUNK = 200;
const CAPTURE_UPDATE_CONCURRENCY = 8;

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
export async function captureWatchedListings(admin: SupabaseClient, maxPages = CAPTURE_MAX_PAGES): Promise<WatchCaptureResult> {
  const { data: profileData } = await admin
    .from("marketplace_search_profiles")
    .select("id, edition_id")
    .eq("is_active", true);
  const editionByProfile = new Map<string, string>((profileData ?? []).map((row: { id: string; edition_id: string }) => [row.id, row.edition_id]));
  if (!editionByProfile.size) return { captured: 0, updated: 0, skipped: 0, leadsRead: 0, truncated: false };

  const result: WatchCaptureResult = { captured: 0, updated: 0, skipped: 0, leadsRead: 0, truncated: false };
  const pages = Math.max(1, Math.floor(maxPages));

  // Every non-dismissed lead, in a deterministic order, a bounded page at a
  // time. A stable order by id is what makes paging complete: without it,
  // PostgREST may return overlapping or missing rows across pages.
  for (let page = 0; page < pages; page += 1) {
    const from = page * CAPTURE_PAGE_SIZE;
    const { data: leadData, error: leadError } = await admin
      .from("scout_listing_leads")
      .select("id,profile_id,source_id,external_id,source_listing_url,listing_title,listing_price,currency,item_end_at,first_seen_at,last_seen_at,raw_payload,match_assessment")
      .in("profile_id", [...editionByProfile.keys()])
      .neq("review_status", "dismissed")
      .order("id", { ascending: true })
      .range(from, from + CAPTURE_PAGE_SIZE - 1);
    if (leadError) throw new Error(`Watched leads could not be read: ${leadError.message}`);
    const leads = (leadData ?? []) as LeadRow[];
    result.leadsRead = (result.leadsRead ?? 0) + leads.length;
    await captureLeadPage(admin, leads, editionByProfile, result);
    if (leads.length < CAPTURE_PAGE_SIZE) return result;
  }
  // Pages ran out before the leads did. Said, not hidden.
  result.truncated = true;
  return result;
}

function outcomeRowForLead(lead: LeadRow, editionId: string, marketplace: string) {
  const item = readItem(lead.raw_payload);
  return {
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
}

async function captureLeadPage(
  admin: SupabaseClient,
  leads: LeadRow[],
  editionByProfile: Map<string, string>,
  result: WatchCaptureResult,
) {
  type Prepared = { lead: LeadRow; marketplace: string; row: ReturnType<typeof outcomeRowForLead> };
  const prepared: Prepared[] = [];
  for (const lead of leads) {
    const editionId = editionByProfile.get(lead.profile_id);
    if (!editionId) { result.skipped += 1; continue; }
    const marketplace = ebayMarketplaceFromUrl(lead.source_listing_url) ?? process.env.EBAY_MARKETPLACE_ID ?? "EBAY_GB";
    prepared.push({ lead, marketplace, row: outcomeRowForLead(lead, editionId, marketplace) });
  }

  const sightings: Prepared[] = [];
  for (let index = 0; index < prepared.length; index += CAPTURE_UPSERT_CHUNK) {
    const chunk = prepared.slice(index, index + CAPTURE_UPSERT_CHUNK);
    // One listing seen by two profiles is still one listing: the first lead
    // in id order is offered for insert, later ones are only sightings.
    const keys = new Set<string>();
    const offered: Prepared[] = [];
    for (const entry of chunk) {
      const key = `${entry.marketplace}|${entry.lead.external_id}`;
      if (keys.has(key)) sightings.push(entry);
      else { keys.add(key); offered.push(entry); }
    }

    // ignoreDuplicates keeps the original snapshot and any human decision
    // intact: a listing already being watched is never rewritten by a later
    // sighting of the same listing.
    const { data: inserted, error } = await admin
      .from("listing_outcomes")
      .upsert(offered.map((entry) => entry.row), { onConflict: "marketplace,external_id", ignoreDuplicates: true })
      .select("marketplace,external_id");
    if (error) {
      // One bad row must not cost the other 199 their capture: fall back to
      // one insert each, which is what this function always used to do.
      for (const entry of offered) {
        const { data: single, error: singleError } = await admin
          .from("listing_outcomes")
          .upsert(entry.row, { onConflict: "marketplace,external_id", ignoreDuplicates: true })
          .select("id");
        if (singleError) { result.skipped += 1; continue; }
        if (single?.length) result.captured += 1;
        else sightings.push(entry);
      }
      continue;
    }
    const insertedKeys = new Set(((inserted ?? []) as Array<{ marketplace: string; external_id: string }>)
      .map((row) => `${row.marketplace}|${row.external_id}`));
    for (const entry of offered) {
      if (insertedKeys.has(`${entry.marketplace}|${entry.lead.external_id}`)) result.captured += 1;
      else sightings.push(entry);
    }
  }

  for (let index = 0; index < sightings.length; index += CAPTURE_UPDATE_CONCURRENCY) {
    await Promise.all(sightings.slice(index, index + CAPTURE_UPDATE_CONCURRENCY).map(async (entry) => {
      await admin.from("listing_outcomes")
        .update({ last_seen_at: entry.lead.last_seen_at, updated_at: new Date().toISOString() })
        .eq("marketplace", entry.marketplace)
        .eq("external_id", entry.lead.external_id)
        // Only ever forward: an older sighting from a second profile must not
        // wind back a fresher live confirmation.
        .lt("last_seen_at", entry.lead.last_seen_at)
        // Never disturb a row a human has finished with.
        .in("status", ["active", "ended_pending_check"]);
      result.updated += 1;
    }));
  }
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

// An API-confirmed live listing begins a fresh watch cycle. An old end time
// must not immediately send it back to the check queue on the next run.
export function activeListingEndAt(previous: string | null, reported: string | null, nowIso: string) {
  const usableFuture = (value: string | null) => value && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.parse(nowIso) ? value : null;
  return usableFuture(reported) ?? usableFuture(previous);
}

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
    // A listing a provider confirmed live is already on the STILL_LIVE_RECHECK
    // cadence (next_check_at set). Promoting it here as well would pull it
    // into the first-priority lane and defeat the point of the slow lane.
    .is("next_check_at", null)
    .lt("last_seen_at", unseenBefore)
    .select("id");

  return (explicitlyEnded?.length ?? 0) + (unseen?.length ?? 0);
}

export async function runOutcomeChecks(
  admin: SupabaseClient,
  limit = DEFAULT_OUTCOME_CHECK_LIMIT,
  resolve = resolveListingOutcome,
  selected?: { outcomeIds: string[]; immediateFirstCheck: boolean },
): Promise<OutcomeCheckResult> {
  const result: OutcomeCheckResult = { due: 0, checked: 0, soldCandidates: 0, unsold: 0, ambiguous: 0, inaccessible: 0, stillActive: 0, exhausted: 0, stillLiveRechecks: 0, watchExpired: 0, errors: [], dailySpent: null, dailyRemaining: null, dailyReserved: null, budgetUnavailable: false, ceilingReached: false };
  const reservationId = crypto.randomUUID();
  let budget: { granted: number; spent: number; reserved: number; remaining: number; day: string };
  try {
    const requested = Number.isFinite(limit) ? Math.max(0, Math.min(DEFAULT_OUTCOME_CHECK_LIMIT, Math.floor(limit))) : 0;
    const { data, error } = await admin.rpc("reserve_outcome_checks", { p_reservation_id: reservationId, p_requested: requested });
    if (error || !data || !Number.isInteger(data.granted) || data.granted < 0 || data.granted > requested || typeof data.day !== "string") throw new Error("invalid reservation");
    budget = data;
  } catch {
    result.budgetUnavailable = true;
    result.errors.push("Outcome-check budget is unavailable. No provider calls were made; retry when accounting is restored.");
    return result;
  }
  result.dailySpent = budget.spent;
  result.dailyReserved = budget.reserved;
  result.dailyRemaining = budget.remaining;
  const effectiveLimit = budget.granted;
  let attempted = 0;
  try {
  if (!effectiveLimit) { result.ceilingReached = budget.remaining === 0; return result; }
  const nowIso = new Date().toISOString();

  type QueueRow = {
    id: string; external_id: string; marketplace: string; listing_title: string;
    status: OutcomeStatus; scheduled_end_at: string | null; next_check_at: string | null; check_attempts: number; outcome_provider: string | null;
    buying_format?: string | null; first_seen_at?: string | null;
  };
  // A staff observation is stronger than another automatic retry. Preserve it
  // until staff either supplies the missing sale details or dismisses it.
  const notStaffObserved = (row: QueueRow) => row.outcome_provider !== "eBay page — staff observed";

  // Lane 1: newly ended, never-checked and retrying listings.
  let query = admin
    .from("listing_outcomes")
    .select(OUTCOME_QUEUE_COLUMNS)
    .in("status", ["ended_pending_check", "ambiguous"])
    .is("reviewed_by", null)
    .is("resulting_observation_id", null);
  if (selected) query = query.in("id", selected.outcomeIds);
  else query = query.or(outcomeCheckQueueFilter(nowIso));
  const { data, error: queueError } = await query
    .order("next_check_at", { ascending: true, nullsFirst: true })
    .limit(effectiveLimit);
  if (queueError) throw new Error("RAR could not load outcome checks. Retry the pipeline; no listings were changed.");

  const rows = (data ?? []) as QueueRow[];
  const due = rows.filter((row) => notStaffObserved(row) && (
    isDueForCheck(row) || Boolean(selected?.immediateFirstCheck
      && row.status === "ended_pending_check"
      && row.check_attempts === 0
      && row.outcome_provider === SOLD_SEARCH_DISCOVERY_PROVIDER
      && row.scheduled_end_at
      && new Date(row.scheduled_end_at).getTime() <= Date.now() - 24 * 60 * 60_000)
  ));

  // Lane 2: still-live listings due their slow recheck, oldest due first,
  // only with capacity lane 1 did not need. The daily reservation above has
  // already bounded the total, so this can never add calls beyond it.
  const spare = effectiveLimit - due.length;
  if (!selected && spare > 0) {
    const { data: weeklyData, error: weeklyError } = await admin
      .from("listing_outcomes")
      .select(OUTCOME_QUEUE_COLUMNS)
      .eq("status", "active")
      .is("reviewed_by", null)
      .is("resulting_observation_id", null)
      .or(stillLiveRecheckQueueFilter(nowIso))
      .order("next_check_at", { ascending: true })
      .limit(spare);
    if (weeklyError) result.errors.push("Still-live rechecks could not be loaded this run; first checks were unaffected.");
    const weekly = ((weeklyData ?? []) as QueueRow[]).filter((row) => notStaffObserved(row) && isDueForCheck(row));
    result.stillLiveRechecks = weekly.length;
    due.push(...weekly);
  }
  result.due = due.length;

  for (let index = 0; index < due.length; index += OUTCOME_CHECK_CONCURRENCY) {
    // A reservation is for one UTC day. Do not spend yesterday's allocation.
    if (new Date().toISOString().slice(0, 10) !== budget.day) {
      result.errors.push("UTC day changed. Remaining checks were left for a new run.");
      break;
    }
    const chunk = due.slice(index, index + OUTCOME_CHECK_CONCURRENCY);
    await Promise.all(chunk.map(async (row) => {
    const attempt = row.check_attempts + 1;
    let providerResult;
    try {
      attempted += 1;
      providerResult = await resolve(row.external_id, row.marketplace, row.listing_title);
    } catch (error) {
      const message = error instanceof Error ? error.message : "outcome provider failed";
      result.errors.push(`${row.external_id}: ${message}`);
      const { error: auditError } = await admin.from("listing_outcome_checks").insert({
        outcome_id: row.id, provider: "unavailable", attempt_number: attempt,
        listing_state: "unknown", resulting_status: row.status, detail: message,
      });
      if (auditError) { result.errors.push(`${row.external_id}: could not save the failed-check audit; listing unchanged.`); return; }
      // A transient failure must not consume the listing's retries or push it
      // toward a conclusion. It stays where it is and comes round again.
      const { error: retryError } = await admin.from("listing_outcomes").update({
        last_checked_at: nowIso, last_error: message,
        next_check_at: nextOutcomeCheckAt(Math.max(0, attempt - 1)), updated_at: nowIso,
      }).eq("id", row.id).eq("status", row.status).eq("check_attempts", row.check_attempts)
        .is("reviewed_by", null).is("resulting_observation_id", null);
      if (retryError) result.errors.push(`${row.external_id}: could not schedule retry; run the pipeline again.`);
      return;
    }

    const classification = classifyListingOutcome(providerResult.signal);
    // A positive live read is not an unresolved failure. Retry exhaustion is
    // only for checks that genuinely could not determine the listing state.
    // A still-live listing goes back on the slow cadence instead, until it
    // ends or has been watched for MAX_WATCH_DAYS.
    const activeAgain = classification.status === "active";
    const followUp = activeAgain ? stillLiveFollowUp(providerResult.signal.provider, row.first_seen_at, new Date(nowIso)) : null;
    const watchExpired = followUp?.kind === "expired";
    const stillLive = activeAgain && !watchExpired;
    const exhausted = !activeAgain && !classification.resolved && attempt >= MAX_OUTCOME_ATTEMPTS;
    const final = followUp?.kind === "expired"
      ? followUp.classification
      : exhausted ? exhaustedOutcome(providerResult.signal.provider, attempt)
        : stillLive ? { ...classification, reason: `${classification.reason} RAR will check it again in ${STILL_LIVE_RECHECK_DAYS} days.` }
          : classification;
    const providerTrail = providerResult.attempts ?? [];
    const auditDetail = providerTrail.length > 1
      ? `${final.reason} Provider path: ${providerTrail.map((item) => `${item.provider}=${item.listingState}${item.detail ? ` (${item.detail})` : ""}`).join(" -> ")}`
      : final.reason;

    const { error: auditError } = await admin.from("listing_outcome_checks").insert({
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
    if (auditError) { result.errors.push(`${row.external_id}: could not save the check audit; listing unchanged.`); return; }

    // Never overwrite a human. If someone reviewed this row while the check
    // was in flight, their decision stands and the check is recorded only.
    const { data: updated, error: updateError } = await admin.from("listing_outcomes").update({
      status: final.status,
      sold_price: final.soldPrice,
      sold_currency: final.soldCurrency,
      sold_at: final.soldAt,
      outcome_reason: final.reason,
      outcome_provider: providerResult.signal.provider,
      check_attempts: stillLive ? 0 : attempt,
      ...(activeAgain ? {
        last_seen_at: nowIso,
        scheduled_end_at: activeListingEndAt(row.scheduled_end_at, providerResult.signal.scheduledEndAt, nowIso),
      } : {}),
      last_checked_at: nowIso,
      last_error: null,
      next_check_at: followUp?.kind === "recheck" ? followUp.nextCheckAt
        : final.resolved || exhausted ? null : nextOutcomeCheckAt(attempt),
      updated_at: nowIso,
    }).eq("id", row.id).eq("status", row.status).eq("check_attempts", row.check_attempts)
      .is("reviewed_by", null).is("resulting_observation_id", null).select("id").maybeSingle();
    if (updateError) { result.errors.push(`${row.external_id}: ${updateError.message}`); return; }
    if (!updated) return;

    result.checked += 1;
    if (exhausted) result.exhausted += 1;
    if (watchExpired) result.watchExpired += 1;
    if (final.status === "sold_candidate") result.soldCandidates += 1;
    else if (final.status === "unsold") result.unsold += 1;
    else if (final.status === "inaccessible") result.inaccessible += 1;
    else if (final.status === "ambiguous") result.ambiguous += 1;
    else if (final.status === "active") result.stillActive += 1;
    }));
  }

  return result;
  } finally {
    // Refund only work never attempted. Failure retains the allocation,
    // which is conservative even if a process dies after an external call.
    try {
      const { error } = await admin.rpc("settle_outcome_checks", { p_reservation_id: reservationId, p_attempted: attempted });
      if (error) throw new Error(error.message);
    } catch {
      result.errors.push("Unused outcome-check capacity could not be released; its reservation remains charged today.");
    }
  }
}

export async function readWatchToSaleMetrics(admin: SupabaseClient) {
  const nowIso = new Date().toISOString();
  const byStatus = async (status: OutcomeStatus) => {
    const { count } = await admin.from("listing_outcomes").select("id", { count: "exact", head: true }).eq("status", status);
    return count ?? 0;
  };

  // "Remove from queue" also ends in review_complete, so that status alone
  // is not a sale. A sale is the row that produced a price observation.
  const reviewComplete = async (producedSale: boolean) => {
    const query = admin.from("listing_outcomes").select("id", { count: "exact", head: true }).eq("status", "review_complete");
    const { count } = await (producedSale ? query.not("resulting_observation_id", "is", null) : query.is("resulting_observation_id", null));
    return count ?? 0;
  };

  const [watching, soldCandidates, confirmed, dismissed, unsold, ambiguous, inaccessible] = await Promise.all([
    byStatus("active"), byStatus("sold_candidate"), reviewComplete(true), reviewComplete(false),
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
    watch_dismissed: dismissed,
    watch_unsold: unsold,
    watch_ambiguous: ambiguous,
    watch_inaccessible: inaccessible,
    watch_api_failures: failing ?? 0,
    watch_next_check_at: nextDue?.[0]?.next_check_at ?? null,
  };
}
