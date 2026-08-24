import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { findActiveEbayListings, getEbayApplicationToken } from "@/lib/ebayScout";
import { buildScoutLeadRow, storeScoutLeads } from "@/lib/scoutIngest";
import { loadActiveScoutRules } from "@/lib/scoutRules";
import { seedMissingEbayProfiles } from "@/lib/scoutProfileSeed";
import { selectScoutProfiles, SCOUT_PUBLIC_FRESHNESS_HOURS, type ScoutCoverageLead } from "@/lib/scoutCoverage";

export const maxDuration = 60;

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

const DAILY_PROFILE_LIMIT = 50;
const SCAN_CONCURRENCY = 4;

function isAuthorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return Response.json({ error: "Unauthorized cron request." }, { status: 401 });

  const admin = getSupabaseAdmin();
  let createdProfiles = 0;
  try {
    createdProfiles = (await seedMissingEbayProfiles(admin)).created;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "RAR could not prepare Scout coverage." }, { status: 500 });
  }
  const { data, error } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,collection_interval_days,last_checked_at,source:sources!inner(id,name),edition:manga_editions(title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no)")
    .eq("is_active", true)
    .eq("source.name", "eBay Sold")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(1000);
  const profiles = (data ?? []) as unknown as Profile[];
  if (error) return Response.json({ error: "RAR could not load the daily Scout profiles." }, { status: 500 });

  const activeProfiles = profiles.filter((profile) => profile.source?.name === "eBay Sold" && profile.edition);
  if (!activeProfiles.length) return Response.json({ createdProfiles, scannedProfiles: 0, activeLeads: 0, failures: 0 });

  const cutoff = new Date(Date.now() - SCOUT_PUBLIC_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
  const profileIds = activeProfiles.map((profile) => profile.id);
  const recentLeads: ScoutCoverageLead[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data: leadRows, error: leadError } = await admin.from("scout_listing_leads")
      .select("profile_id,external_id,listing_title,item_end_at,last_seen_at,review_status")
      .in("profile_id", profileIds)
      .in("review_status", ["new", "watching"])
      .gte("last_seen_at", cutoff)
      .range(offset, offset + 999);
    if (leadError) return Response.json({ error: "RAR could not measure current Scout coverage." }, { status: 500 });
    recentLeads.push(...((leadRows ?? []) as ScoutCoverageLead[]));
    if ((leadRows ?? []).length < 1000) break;
  }
  const selection = selectScoutProfiles(activeProfiles, recentLeads, DAILY_PROFILE_LIMIT);
  const profilesToScan = selection.selected;

  let token: string;
  try {
    token = await getEbayApplicationToken();
  } catch {
    return Response.json({ error: "eBay did not issue RAR an application token." }, { status: 503 });
  }
  const rules = await loadActiveScoutRules(admin);

  const scanProfile = async (profile: Profile) => {
    try {
      const listings = await findActiveEbayListings(profile.search_query, token);
      const checkedAt = new Date().toISOString();
      const builds = listings.map((listing) => buildScoutLeadRow(profile.id, profile.source!.id, profile.edition!, listing, checkedAt, rules));
      await storeScoutLeads(admin, profile.id, builds);
      const { error: scanError } = await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "completed", result_count: builds.length });
      if (scanError) throw new Error("RAR could not record the completed Scout scan.");
      await admin.from("marketplace_search_profiles").update({ last_checked_at: checkedAt, last_checked_result_count: builds.length, updated_at: checkedAt }).eq("id", profile.id);
      return { activeLeads: builds.length, failed: false };
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Scout could not complete this scan.";
      await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "failed", result_count: 0, error_message: message });
      return { activeLeads: 0, failed: true };
    }
  };

  const results: Array<{ activeLeads: number; failed: boolean }> = [];
  for (let offset = 0; offset < profilesToScan.length; offset += SCAN_CONCURRENCY) {
    const batch = profilesToScan.slice(offset, offset + SCAN_CONCURRENCY);
    results.push(...await Promise.all(batch.map(scanProfile)));
  }

  const activeLeads = results.reduce((total, result) => total + result.activeLeads, 0);
  const failures = results.filter((result) => result.failed).length;
  const scannedProfiles = results.length - failures;

  return Response.json({
    createdProfiles,
    activeProfiles: activeProfiles.length,
    coveredProfiles: selection.coveredProfiles,
    discoveryScans: selection.discoverySelected,
    maintenanceScans: selection.maintenanceSelected,
    scannedProfiles,
    activeLeads,
    failures,
  });
}
