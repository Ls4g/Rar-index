import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { assessEditionMatch } from "@/lib/editionMatch";
import { findActiveEbayListings, getEbayApplicationToken } from "@/lib/ebayScout";

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
  } | null;
};

function isAuthorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

function isDue(profile: Profile, now: number) {
  if (!profile.last_checked_at) return true;
  const lastCheckedAt = new Date(profile.last_checked_at).getTime();
  const interval = Math.max(profile.collection_interval_days ?? 7, 1) * 86_400_000;
  return Number.isNaN(lastCheckedAt) || now - lastCheckedAt >= interval;
}

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return Response.json({ error: "Unauthorized cron request." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,collection_interval_days,last_checked_at,source:sources!inner(id,name),edition:manga_editions(title,series,volume_number,language,isbn_13,publisher)")
    .eq("is_active", true)
    .eq("source.name", "eBay Sold")
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(50);
  const profiles = (data ?? []) as unknown as Profile[];
  if (error) return Response.json({ error: "RAR could not load the daily Scout profiles." }, { status: 500 });

  // The daily job intentionally processes a small due batch. That keeps API
  // usage controlled while each active profile is revisited on its cadence.
  const dueProfiles = profiles.filter((profile) => profile.source?.name === "eBay Sold" && profile.edition && isDue(profile, Date.now())).slice(0, 6);
  if (!dueProfiles.length) return Response.json({ scannedProfiles: 0, activeLeads: 0, failures: 0 });

  let token: string;
  try {
    token = await getEbayApplicationToken();
  } catch {
    return Response.json({ error: "eBay did not issue RAR an application token." }, { status: 503 });
  }

  let activeLeads = 0;
  let failures = 0;
  for (const profile of dueProfiles) {
    try {
      const listings = await findActiveEbayListings(profile.search_query, token);
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
      await admin.from("marketplace_search_profiles").update({ last_checked_at: checkedAt, last_checked_result_count: rows.length, updated_at: checkedAt }).eq("id", profile.id);
      activeLeads += rows.length;
    } catch (caught) {
      failures += 1;
      const message = caught instanceof Error ? caught.message : "Scout could not complete this scan.";
      await admin.from("scout_scans").insert({ profile_id: profile.id, provider: "ebay_browse", status: "failed", result_count: 0, error_message: message });
    }
  }

  return Response.json({ scannedProfiles: dueProfiles.length, activeLeads, failures });
}
