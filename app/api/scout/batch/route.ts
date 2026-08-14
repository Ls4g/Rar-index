import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { findActiveEbayListings, getEbayApplicationToken } from "@/lib/ebayScout";
import { buildScoutLeadRow, storeScoutLeads } from "@/lib/scoutIngest";

export const maxDuration = 60;

type Profile = {
  id: string;
  search_query: string;
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

function cleanLimit(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 20;
  return Math.max(1, Math.min(Math.floor(numeric), 20));
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { limit?: unknown } = {};
  try {
    payload = await request.json();
  } catch {
    // The safe default batch size applies when no body was sent.
  }

  const admin = getSupabaseAdmin();
  const limit = cleanLimit(payload.limit);
  const { data, error } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,source:sources!inner(id,name),edition:manga_editions(title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no)")
    .eq("is_active", true)
    .eq("source.name", "eBay Sold")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(limit);

  const profiles = ((data ?? []) as unknown as Profile[]).filter((profile) => profile.source?.name === "eBay Sold" && profile.edition);
  if (error) return Response.json({ error: "RAR could not load the next Scout profiles." }, { status: 500 });
  if (!profiles.length) return Response.json({ scannedProfiles: 0, activeLeads: 0, failures: 0 });

  let applicationToken: string;
  try {
    applicationToken = await getEbayApplicationToken();
  } catch {
    return Response.json({ error: "eBay did not issue RAR an application token." }, { status: 503 });
  }

  let activeLeads = 0;
  let failures = 0;
  let completedProfiles = 0;

  for (const profile of profiles) {
    try {
      const listings = await findActiveEbayListings(profile.search_query, applicationToken);
      const checkedAt = new Date().toISOString();
      const builds = listings.map((listing) => buildScoutLeadRow(profile.id, profile.source!.id, profile.edition!, listing, checkedAt));
      await storeScoutLeads(admin, profile.id, builds);

      const { error: scanError } = await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "completed", result_count: builds.length });
      if (scanError) throw new Error("RAR could not record the completed Scout scan.");

      const { error: checkedError } = await admin
        .from("marketplace_search_profiles")
        .update({ last_checked_at: checkedAt, last_checked_result_count: builds.length, updated_at: checkedAt })
        .eq("id", profile.id);
      if (checkedError) throw new Error("RAR could not record when this profile was checked.");

      completedProfiles += 1;
      activeLeads += builds.length;
    } catch (caught) {
      failures += 1;
      const message = caught instanceof Error ? caught.message : "Scout could not complete this scan.";
      await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "failed", result_count: 0, error_message: message });
    }
  }

  return Response.json({ scannedProfiles: completedProfiles, activeLeads, failures });
}
