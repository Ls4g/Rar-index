import type { SupabaseClient } from "@supabase/supabase-js";
import { looksGraded } from "./editionMatch.ts";
import { assessScoutListing, type ScoutEdition } from "./scoutIngest.ts";
import { surplusScoutLeadIds, type ScoutTriageCoverageLead } from "./scoutCoverage.ts";

export const SCOUT_STALE_AFTER_DAYS = 8;
export const SCOUT_STALE_AFTER_MS = SCOUT_STALE_AFTER_DAYS * 86_400_000;

export type ScoutDiagnosticLead = {
  id: string;
  externalId: string;
  profileId: string;
  listingTitle: string;
  itemEndAt: string | null;
  lastSeenAt: string;
  edition: ScoutEdition | null;
  editionId?: string;
  reviewStatus?: "new" | "watching";
};

export type ScoutBacklogDiagnostics = {
  total: number;
  reviewNow: number;
  strong: number;
  partial: number;
  lowConfidence: number;
  unresolvedConflicts: number;
  stale: number;
  expiredWithEndDate: number;
  duplicateGroups: number;
  duplicateRows: number;
  profilesNeedingTuning: number;
  graded: number;
};

type DatabaseLead = {
  id: string;
  external_id: string;
  listing_title: string;
  item_end_at: string | null;
  last_seen_at: string;
  review_status: "new" | "watching";
  profile: { id: string; edition: (ScoutEdition & { id: string }) | null } | null;
};

export function isScoutLeadStale(lastSeenAt: string, now = Date.now()) {
  const seen = new Date(lastSeenAt).getTime();
  return !Number.isFinite(seen) || now - seen > SCOUT_STALE_AFTER_MS;
}

export function diagnoseScoutBacklog(leads: ScoutDiagnosticLead[], now = Date.now()): ScoutBacklogDiagnostics {
  const externalIds = new Map<string, number>();
  const profiles = new Map<string, { total: number; reviewable: number }>();
  let reviewNow = 0;
  let strong = 0;
  let partial = 0;
  let lowConfidence = 0;
  let unresolvedConflicts = 0;
  let stale = 0;
  let expiredWithEndDate = 0;
  let graded = 0;
  let total = 0;
  const coverageLeads: ScoutTriageCoverageLead[] = [];

  for (const lead of leads) {
    const reviewStatus = lead.reviewStatus ?? "new";
    const isNew = reviewStatus === "new";
    const isGraded = looksGraded(lead.listingTitle);
    const expired = Boolean(lead.itemEndAt) && new Date(lead.itemEndAt as string).getTime() <= now;
    const isStale = isScoutLeadStale(lead.lastSeenAt, now);
    const assessment = lead.edition ? assessScoutListing(lead.edition, lead.listingTitle) : null;
    coverageLeads.push({
      id: lead.id,
      editionId: lead.editionId ?? lead.profileId,
      reviewStatus,
      isExpired: expired,
      isStale,
      isGraded,
      score: assessment?.score ?? 0,
      itemEndAt: lead.itemEndAt,
      lastSeenAt: lead.lastSeenAt,
    });

    if (!isNew) continue;
    total += 1;
    externalIds.set(lead.externalId, (externalIds.get(lead.externalId) ?? 0) + 1);
    if (isGraded) graded += 1;

    if (expired) expiredWithEndDate += 1;
    else if (isStale) stale += 1;

    if (!lead.edition) {
      lowConfidence += 1;
      continue;
    }

    if (assessment?.confidence === "strong") strong += 1;
    else if (assessment?.confidence === "partial") partial += 1;
    else if (assessment?.confidence === "conflict") unresolvedConflicts += 1;
    else lowConfidence += 1;

    const reviewable = (assessment?.score ?? 0) >= 50;
    const profile = profiles.get(lead.profileId) ?? { total: 0, reviewable: 0 };
    profile.total += 1;
    if (reviewable) profile.reviewable += 1;
    profiles.set(lead.profileId, profile);
  }

  const surplusLeadIds = surplusScoutLeadIds(coverageLeads);
  reviewNow = coverageLeads.filter((lead) => lead.reviewStatus === "new"
    && !lead.isExpired
    && !lead.isStale
    && !lead.isGraded
    && lead.score >= 50
    && !surplusLeadIds.has(lead.id)).length;

  const duplicated = [...externalIds.values()].filter((count) => count > 1);
  const profilesNeedingTuning = [...profiles.values()].filter(({ total, reviewable }) => total >= 10 && reviewable / total < 0.25).length;

  return {
    total,
    reviewNow,
    strong,
    partial,
    lowConfidence,
    unresolvedConflicts,
    stale,
    expiredWithEndDate,
    duplicateGroups: duplicated.length,
    duplicateRows: duplicated.reduce((sum, count) => sum + count - 1, 0),
    profilesNeedingTuning,
    graded,
  };
}

export async function readScoutBacklog(admin: SupabaseClient): Promise<ScoutDiagnosticLead[]> {
  const all: ScoutDiagnosticLead[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 10_000; from += pageSize) {
    const { data, error } = await admin
      .from("scout_listing_leads")
      .select("id,external_id,listing_title,item_end_at,last_seen_at,review_status,profile:marketplace_search_profiles!inner(id,edition:manga_editions!inner(id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no))")
      .in("review_status", ["new", "watching"])
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Market Scout could not diagnose its lead backlog: ${error.message}`);
    const page = (data ?? []) as unknown as DatabaseLead[];
    all.push(...page.map((lead) => ({
      id: lead.id,
      externalId: lead.external_id,
      profileId: lead.profile?.id ?? "unknown",
      listingTitle: lead.listing_title,
      itemEndAt: lead.item_end_at,
      lastSeenAt: lead.last_seen_at,
      edition: lead.profile?.edition ?? null,
      editionId: lead.profile?.edition?.id,
      reviewStatus: lead.review_status,
    })));
    if (page.length < pageSize) break;
  }
  return all;
}
