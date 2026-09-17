import type { SupabaseClient } from "@supabase/supabase-js";
import { checkEbayConnectionHealth, checkEbayListingAvailability, getEbayApplicationToken, type EbayAvailabilityCheck, type EbayConnectionHealth } from "./ebayScout.ts";
import { AVAILABILITY_STALE_AFTER_MS } from "./scoutDiagnostics.ts";

/* 25 a day against a 241 backlog left roughly nine days of queue latency on
   top of the staleness wait. At 100 the standing backlog drains in about five
   days and then idles well under the ceiling. Still bounded: one run cannot
   fan out, and 100 calls a day is about 2% of eBay's documented 5,000. */
export const CHECK_BATCH_SIZE = 100;

type AvailabilityLead = {
  id: string;
  external_id: string;
  listing_title: string;
  last_seen_at: string;
  raw_payload: { listingMarketplaceId?: string } | null;
};

export type ScoutAvailabilityResult = {
  /** Every lead eligible for a check right now, not the slice this run took.
      It used to be leads.length after .limit(CHECK_BATCH_SIZE) had already
      applied, so it could never exceed the batch size and understated a real
      backlog of 241 as 25. Anything reporting a backlog must read this. */
  queued: number;
  /** The per-run ceiling, so a reader can tell a full batch from a drained
      queue without knowing the constant. */
  batchLimit: number;
  examined: number;
  active: number;
  unavailable: number;
  inconclusive: number;
  protectedByRace: number;
  connectionStatus: EbayConnectionHealth["status"] | "not_needed";
  warning: string | null;
};

async function countEligibleLeads(admin: SupabaseClient, staleBefore: string): Promise<number | null> {
  try {
    const { count, error } = await admin
      .from("scout_listing_leads")
      .select("id", { count: "exact", head: true })
      .eq("review_status", "new")
      .lt("last_seen_at", staleBefore)
      .or(`availability_checked_at.is.null,availability_checked_at.lt.${staleBefore}`);
    if (error || typeof count !== "number") return null;
    return count;
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(rows: T[], limit: number, worker: (row: T) => Promise<R>) {
  const output: R[] = new Array(rows.length);
  let next = 0;
  async function consume() {
    while (next < rows.length) {
      const index = next;
      next += 1;
      output[index] = await worker(rows[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, consume));
  return output;
}

export async function refreshStaleScoutAvailability(
  admin: SupabaseClient,
  runId: string,
): Promise<ScoutAvailabilityResult> {
  const staleBefore = new Date(Date.now() - AVAILABILITY_STALE_AFTER_MS).toISOString();
  const { data, error } = await admin
    .from("scout_listing_leads")
    .select("id,external_id,listing_title,last_seen_at,raw_payload")
    .eq("review_status", "new")
    .lt("last_seen_at", staleBefore)
    .or(`availability_checked_at.is.null,availability_checked_at.lt.${staleBefore}`)
    .order("availability_checked_at", { ascending: true, nullsFirst: true })
    .order("last_seen_at", { ascending: true })
    .limit(CHECK_BATCH_SIZE);
  if (error) throw new Error(`Market Scout could not load stale availability checks: ${error.message}`);
  const leads = (data ?? []) as AvailabilityLead[];
  // Same predicate, no limit. Falls back to the batch length rather than
  // failing the run, so a reporting query can never stop the work.
  const eligible = await countEligibleLeads(admin, staleBefore);
  const queued = eligible ?? leads.length;
  if (!leads.length) return { queued, batchLimit: CHECK_BATCH_SIZE, examined: 0, active: 0, unavailable: 0, inconclusive: 0, protectedByRace: 0, connectionStatus: "not_needed", warning: null };

  const connection = await checkEbayConnectionHealth();
  if (connection.status !== "connected") {
    return {
      queued,
      batchLimit: CHECK_BATCH_SIZE,
      examined: 0,
      active: 0,
      unavailable: 0,
      inconclusive: 0,
      protectedByRace: 0,
      connectionStatus: connection.status,
      warning: `${connection.message} ${leads.length} stale lead${leads.length === 1 ? " was" : "s were"} left untouched.`,
    };
  }
  const token = await getEbayApplicationToken();
  const checks = await mapWithConcurrency(leads, 5, async (lead) => ({
    lead,
    check: await checkEbayListingAvailability(
      lead.external_id,
      lead.raw_payload?.listingMarketplaceId ?? process.env.EBAY_MARKETPLACE_ID ?? "EBAY_US",
      token,
    ),
  }));

  const active = checks.filter(({ check }) => check.outcome === "active").map(({ lead, check }) => ({
    lead_id: lead.id,
    item_end_at: check.itemEndAt,
    decision_notes: check.reason,
  }));
  const unavailable = checks.filter(({ check }) => check.outcome === "unavailable").map(({ lead, check }) => ({
    lead_id: lead.id,
    item_end_at: check.itemEndAt,
    decision_notes: `Auto-archived by RAR Market Scout after an eBay availability check: ${check.reason}`,
  }));
  const inconclusive = checks.filter(({ check }) => check.outcome === "inconclusive").map(({ lead, check }) => ({
    lead_id: lead.id,
    decision_notes: check.reason,
  }));

  /* The RPC refuses more than 25 leads across the three arrays in one call --
     a guard in 20260819_phase_three_scout_availability.sql. Raising the batch
     to 100 hit it and failed every Market Scout run on 17 September, so the
     results are applied in chunks that respect it. Each chunk is its own
     transaction, which is correct here: a later chunk failing must not undo
     checks already recorded, and the leads it covered simply stay eligible. */
  const RPC_MAX_PER_CALL = 25;
  const tagged = [
    ...active.map((row) => ({ kind: "active" as const, row })),
    ...unavailable.map((row) => ({ kind: "unavailable" as const, row })),
    ...inconclusive.map((row) => ({ kind: "inconclusive" as const, row })),
  ];
  const totals = { active: 0, unavailable: 0, inconclusive: 0 };
  for (let offset = 0; offset < tagged.length; offset += RPC_MAX_PER_CALL) {
    const chunk = tagged.slice(offset, offset + RPC_MAX_PER_CALL);
    const { data: applied, error: applyError } = await admin.rpc("apply_scout_agent_availability_results", {
      p_run_id: runId,
      p_active: chunk.filter((item) => item.kind === "active").map((item) => item.row),
      p_unavailable: chunk.filter((item) => item.kind === "unavailable").map((item) => item.row),
      p_inconclusive: chunk.filter((item) => item.kind === "inconclusive").map((item) => item.row),
    });
    if (applyError) throw new Error(`Market Scout could not save availability results: ${applyError.message}`);
    const chunkResult = (applied ?? {}) as { active?: number; unavailable?: number; inconclusive?: number };
    totals.active += Number(chunkResult.active ?? 0);
    totals.unavailable += Number(chunkResult.unavailable ?? 0);
    totals.inconclusive += Number(chunkResult.inconclusive ?? 0);
  }
  const result = totals;
  const appliedTotal = result.active + result.unavailable + result.inconclusive;
  return {
    queued,
    batchLimit: CHECK_BATCH_SIZE,
    examined: leads.length,
    active: Number(result.active ?? 0),
    unavailable: Number(result.unavailable ?? 0),
    inconclusive: Number(result.inconclusive ?? 0),
    protectedByRace: Math.max(0, leads.length - appliedTotal),
    connectionStatus: "connected",
    warning: null,
  };
}

export function availabilityOutcomeCounts(checks: EbayAvailabilityCheck[]) {
  return checks.reduce((counts, check) => ({ ...counts, [check.outcome]: counts[check.outcome] + 1 }), { active: 0, unavailable: 0, inconclusive: 0 });
}
