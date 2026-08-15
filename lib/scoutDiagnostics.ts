import type { SupabaseClient } from "@supabase/supabase-js";
import { looksGraded } from "./editionMatch.ts";
import { assessScoutListing, type ScoutEdition } from "./scoutIngest.ts";

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
  profile: { id: string; edition: ScoutEdition | null } | null;
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

  for (const lead of leads) {
    externalIds.set(lead.externalId, (externalIds.get(lead.externalId) ?? 0) + 1);
    if (looksGraded(lead.listingTitle)) graded += 1;

    const expired = Boolean(lead.itemEndAt) && new Date(lead.itemEndAt as string).getTime() <= now;
    const isStale = isScoutLeadStale(lead.lastSeenAt, now);
    if (expired) expiredWithEndDate += 1;
    else if (isStale) stale += 1;

    if (!lead.edition) {
      lowConfidence += 1;
      continue;
    }

    const assessment = assessScoutListing(lead.edition, lead.listingTitle);
    if (assessment.confidence === "strong") strong += 1;
    else if (assessment.confidence === "partial") partial += 1;
    else if (assessment.confidence === "conflict") unresolvedConflicts += 1;
    else lowConfidence += 1;

    const reviewable = assessment.score >= 50;
    if (reviewable && !expired && !isStale) reviewNow += 1;
    const profile = profiles.get(lead.profileId) ?? { total: 0, reviewable: 0 };
    profile.total += 1;
    if (reviewable) profile.reviewable += 1;
    profiles.set(lead.profileId, profile);
  }

  const duplicated = [...externalIds.values()].filter((count) => count > 1);
  const profilesNeedingTuning = [...profiles.values()].filter(({ total, reviewable }) => total >= 10 && reviewable / total < 0.25).length;

  return {
    total: leads.length,
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
      .select("id,external_id,listing_title,item_end_at,last_seen_at,profile:marketplace_search_profiles!inner(id,edition:manga_editions!inner(title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no))")
      .eq("review_status", "new")
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
    })));
    if (page.length < pageSize) break;
  }
  return all;
}
