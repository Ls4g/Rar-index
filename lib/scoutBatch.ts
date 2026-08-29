import type { SupabaseClient } from "@supabase/supabase-js";
import { findActiveEbayListings, getEbayApplicationToken } from "./ebayScout.ts";
import { buildScoutLeadRow, storeScoutLeads } from "./scoutIngest.ts";
import { loadActiveScoutRules } from "./scoutRules.ts";
import { SCOUT_PUBLIC_FRESHNESS_HOURS, selectScoutProfiles, type ScoutCoverageLead } from "./scoutCoverage.ts";

type Profile = {
  id: string;
  search_query: string;
  collection_interval_days: number | null;
  last_checked_at: string | null;
  source: { id: string; name: string | null } | null;
  edition: {
    title: string | null;
    series: string | null;
    volume_number: string | number | null;
    language: string | null;
    isbn_13: string | null;
    publisher: string | null;
    format: string | null;
    printing_number: number | null;
    edition_statement: string | null;
    variant_name: string | null;
    collectible_type: string | null;
    issue_year: number | null;
    issue_number_label: string | null;
    cumulative_issue_no: number | null;
  } | null;
};

export type ScoutBatchResult = {
  scannedProfiles: number;
  activeLeads: number;
  failures: number;
  dueProfiles: number;
  discoveryProfiles: number;
  maintenanceProfiles: number;
};

function cleanLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 20;
  return Math.max(1, Math.min(Math.floor(numeric), 20));
}

function isDue(profile: Profile, now: number) {
  if (!profile.last_checked_at) return true;
  const checkedAt = Date.parse(profile.last_checked_at);
  if (!Number.isFinite(checkedAt)) return true;
  const intervalDays = Math.max(1, Number(profile.collection_interval_days ?? 7));
  return checkedAt + intervalDays * 24 * 60 * 60 * 1000 <= now;
}

export async function runScoutBatch(
  admin: SupabaseClient,
  options: { limit?: unknown; dueOnly?: boolean } = {},
): Promise<ScoutBatchResult> {
  const limit = cleanLimit(options.limit);
  const { data, error } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,collection_interval_days,last_checked_at,source:sources!inner(id,name),edition:manga_editions(title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no)")
    .eq("is_active", true)
    .eq("source.name", "eBay Sold")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(1000);

  if (error) throw new Error("RAR could not load the next Scout profiles.");
  const usableProfiles = ((data ?? []) as unknown as Profile[])
    .filter((profile) => profile.source?.name === "eBay Sold" && profile.edition);
  const dueProfiles = usableProfiles.filter((profile) => isDue(profile, Date.now()));
  const candidateProfiles = options.dueOnly ? dueProfiles : usableProfiles;
  if (!candidateProfiles.length) return { scannedProfiles: 0, activeLeads: 0, failures: 0, dueProfiles: dueProfiles.length, discoveryProfiles: 0, maintenanceProfiles: 0 };

  const recentLeads: ScoutCoverageLead[] = [];
  const freshnessCutoff = new Date(Date.now() - SCOUT_PUBLIC_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
  const pageSize = 1000;
  for (let from = 0; from < 10_000; from += pageSize) {
    const { data: leadPage, error: leadError } = await admin
      .from("scout_listing_leads")
      .select("profile_id,external_id,listing_title,item_end_at,last_seen_at,review_status")
      .in("review_status", ["new", "watching"])
      .gte("last_seen_at", freshnessCutoff)
      .order("last_seen_at", { ascending: false })
      .range(from, from + pageSize - 1);
    if (leadError) throw new Error("RAR could not measure current Scout coverage.");
    recentLeads.push(...((leadPage ?? []) as ScoutCoverageLead[]));
    if ((leadPage ?? []).length < pageSize) break;
  }

  const selection = selectScoutProfiles(candidateProfiles, recentLeads, limit);
  const profiles = selection.selected;
  if (!profiles.length) return { scannedProfiles: 0, activeLeads: 0, failures: 0, dueProfiles: dueProfiles.length, discoveryProfiles: 0, maintenanceProfiles: 0 };

  let applicationToken: string;
  try {
    applicationToken = await getEbayApplicationToken();
  } catch {
    throw new Error("eBay did not issue RAR an application token.");
  }

  let activeLeads = 0;
  let failures = 0;
  let scannedProfiles = 0;
  const rules = await loadActiveScoutRules(admin);

  for (const profile of profiles) {
    try {
      const listings = await findActiveEbayListings(profile.search_query, applicationToken);
      const checkedAt = new Date().toISOString();
      const builds = listings.map((listing) => buildScoutLeadRow(profile.id, profile.source!.id, profile.edition!, listing, checkedAt, rules));
      await storeScoutLeads(admin, profile.id, builds);

      const { error: scanError } = await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "completed", result_count: builds.length });
      if (scanError) throw new Error("RAR could not record the completed Scout scan.");

      const { error: checkedError } = await admin
        .from("marketplace_search_profiles")
        .update({ last_checked_at: checkedAt, last_checked_result_count: builds.length, updated_at: checkedAt })
        .eq("id", profile.id);
      if (checkedError) throw new Error("RAR could not record when this profile was checked.");

      scannedProfiles += 1;
      activeLeads += builds.length;
    } catch (caught) {
      failures += 1;
      const message = caught instanceof Error ? caught.message : "Scout could not complete this scan.";
      await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "failed", result_count: 0, error_message: message });
    }
  }

  return {
    scannedProfiles,
    activeLeads,
    failures,
    dueProfiles: dueProfiles.length,
    discoveryProfiles: selection.discoverySelected,
    maintenanceProfiles: selection.maintenanceSelected,
  };
}
