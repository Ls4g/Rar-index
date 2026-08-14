import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { findActiveEbayListings } from "@/lib/ebayScout";
import { buildScoutLeadRow, storeScoutLeads } from "@/lib/scoutIngest";

type Profile = {
  id: string;
  search_query: string;
  is_active: boolean;
  edition_id: string;
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

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: { profileId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Choose an active search profile." }, { status: 400 });
  }

  const profileId = clean(payload.profileId);
  if (!profileId) return Response.json({ error: "Choose an active search profile." }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,is_active,edition_id,source:sources(id,name),edition:manga_editions(title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no)")
    .eq("id", profileId)
    .maybeSingle();
  const profile = data as unknown as Profile | null;
  if (error || !profile?.is_active || !profile.edition || !profile.source) return Response.json({ error: "This Scout profile is not active or lacks edition identifiers." }, { status: 400 });
  if (profile.source.name !== "eBay Sold") return Response.json({ error: "Scout currently supports eBay search profiles only." }, { status: 400 });

  try {
    const listings = await findActiveEbayListings(profile.search_query);
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
    return Response.json({ scanned: builds.length });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Scout could not complete this scan.";
    await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "failed", result_count: 0, error_message: message });
    return Response.json({ error: message }, { status: 503 });
  }
}
