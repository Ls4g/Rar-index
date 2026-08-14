import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { findActiveEbayListings, getEbayApplicationToken } from "@/lib/ebayScout";
import { buildScoutLeadRow, storeScoutLeads } from "@/lib/scoutIngest";

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
  const { data, error } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,collection_interval_days,last_checked_at,source:sources!inner(id,name),edition:manga_editions(title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no)")
    .eq("is_active", true)
    .eq("source.name", "eBay Sold")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(DAILY_PROFILE_LIMIT);
  const profiles = (data ?? []) as unknown as Profile[];
  if (error) return Response.json({ error: "RAR could not load the daily Scout profiles." }, { status: 500 });

  // "Live" can only mean recently checked. Refresh every active eBay profile
  // once a day instead of following the slower completed-sales collection
  // cadence, which left public live listings stale for most editions.
  const activeProfiles = profiles.filter((profile) => profile.source?.name === "eBay Sold" && profile.edition);
  if (!activeProfiles.length) return Response.json({ scannedProfiles: 0, activeLeads: 0, failures: 0 });

  let token: string;
  try {
    token = await getEbayApplicationToken();
  } catch {
    return Response.json({ error: "eBay did not issue RAR an application token." }, { status: 503 });
  }

  const scanProfile = async (profile: Profile) => {
    try {
      const listings = await findActiveEbayListings(profile.search_query, token);
      const checkedAt = new Date().toISOString();
      const builds = listings.map((listing) => buildScoutLeadRow(profile.id, profile.source!.id, profile.edition!, listing, checkedAt));
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
  for (let offset = 0; offset < activeProfiles.length; offset += SCAN_CONCURRENCY) {
    const batch = activeProfiles.slice(offset, offset + SCAN_CONCURRENCY);
    results.push(...await Promise.all(batch.map(scanProfile)));
  }

  const activeLeads = results.reduce((total, result) => total + result.activeLeads, 0);
  const failures = results.filter((result) => result.failed).length;
  const scannedProfiles = results.length - failures;

  return Response.json({ scannedProfiles, activeLeads, failures });
}
