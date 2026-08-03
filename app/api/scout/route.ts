import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { assessEditionMatch } from "@/lib/editionMatch";
import { findActiveEbayListings } from "@/lib/ebayScout";

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
    .select("id,search_query,is_active,edition_id,source:sources(id,name),edition:manga_editions(title,series,volume_number,language,isbn_13,publisher)")
    .eq("id", profileId)
    .maybeSingle();
  const profile = data as unknown as Profile | null;
  if (error || !profile?.is_active || !profile.edition || !profile.source) return Response.json({ error: "This Scout profile is not active or lacks edition identifiers." }, { status: 400 });
  if (profile.source.name !== "eBay Sold") return Response.json({ error: "Scout currently supports eBay search profiles only." }, { status: 400 });

  try {
    const listings = await findActiveEbayListings(profile.search_query);
    const rows = listings.map((listing) => ({
      profile_id: profile.id,
      source_id: profile.source!.id,
      external_id: listing.externalId,
      source_listing_url: listing.url,
      listing_title: listing.title,
      listing_price: Number.isFinite(listing.price) ? listing.price : null,
      currency: listing.currency,
      listing_condition: listing.condition,
      item_end_at: listing.itemEndAt,
      match_assessment: assessEditionMatch(profile.edition!, {
        title: listing.title,
        series: null,
        volume_number: null,
        language: null,
        isbn_13: null,
        publisher: null,
      }),
      raw_payload: { provider: "ebay_browse", item: listing.rawPayload },
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    if (rows.length) {
      const { error: upsertError } = await admin.from("scout_listing_leads").upsert(rows, { onConflict: "profile_id,source_id,external_id" });
      if (upsertError) throw new Error("RAR could not store the active-listing leads.");
    }
    const checkedAt = new Date().toISOString();
    const { error: scanError } = await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "completed", result_count: rows.length });
    if (scanError) throw new Error("RAR could not record the completed Scout scan.");
    const { error: checkedError } = await admin
      .from("marketplace_search_profiles")
      .update({ last_checked_at: checkedAt, last_checked_result_count: rows.length, updated_at: checkedAt })
      .eq("id", profile.id);
    if (checkedError) throw new Error("RAR could not record when this profile was checked.");
    return Response.json({ scanned: rows.length });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Scout could not complete this scan.";
    await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "failed", result_count: 0, error_message: message });
    return Response.json({ error: message }, { status: 503 });
  }
}
