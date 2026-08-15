import type { SupabaseClient } from "@supabase/supabase-js";
import { checkEbayListingAvailability, getEbayApplicationToken, type EbayAvailabilityCheck } from "./ebayScout.ts";
import { SCOUT_STALE_AFTER_MS } from "./scoutDiagnostics.ts";

const CHECK_BATCH_SIZE = 25;

type AvailabilityLead = {
  id: string;
  external_id: string;
  listing_title: string;
  last_seen_at: string;
  raw_payload: { listingMarketplaceId?: string } | null;
};

export type ScoutAvailabilityResult = {
  examined: number;
  active: number;
  unavailable: number;
  inconclusive: number;
  protectedByRace: number;
};

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
  const staleBefore = new Date(Date.now() - SCOUT_STALE_AFTER_MS).toISOString();
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
  if (!leads.length) return { examined: 0, active: 0, unavailable: 0, inconclusive: 0, protectedByRace: 0 };

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

  const { data: applied, error: applyError } = await admin.rpc("apply_scout_agent_availability_results", {
    p_run_id: runId,
    p_active: active,
    p_unavailable: unavailable,
    p_inconclusive: inconclusive,
  });
  if (applyError) throw new Error(`Market Scout could not save availability results: ${applyError.message}`);
  const result = (applied ?? {}) as { active?: number; unavailable?: number; inconclusive?: number };
  const appliedTotal = Number(result.active ?? 0) + Number(result.unavailable ?? 0) + Number(result.inconclusive ?? 0);
  return {
    examined: leads.length,
    active: Number(result.active ?? 0),
    unavailable: Number(result.unavailable ?? 0),
    inconclusive: Number(result.inconclusive ?? 0),
    protectedByRace: Math.max(0, leads.length - appliedTotal),
  };
}

export function availabilityOutcomeCounts(checks: EbayAvailabilityCheck[]) {
  return checks.reduce((counts, check) => ({ ...counts, [check.outcome]: counts[check.outcome] + 1 }), { active: 0, unavailable: 0, inconclusive: 0 });
}
