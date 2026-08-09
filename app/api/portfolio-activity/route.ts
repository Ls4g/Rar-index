import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isPlausibleLiveListing } from "@/lib/liveListings";

// Active Scout listings are already public on every edition page (server
// -rendered there with no auth check) — this route surfaces the same
// public data for a portfolio owner's own editions, from a client
// component that can only hold the anon key. It never reveals anything a
// visitor to /edition/{id} could not already see, and it never touches
// portfolio_holdings, purchase prices, or anything else user-specific.
const MAX_EDITION_IDS = 100;
const FRESHNESS_HOURS = 48;

type LiveLead = {
  id: string;
  profile_id: string;
  review_status: "new" | "watching" | "dismissed";
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  item_end_at: string | null;
  last_seen_at: string;
  raw_payload: unknown;
};

export async function POST(request: Request) {
  let payload: { editionIds?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a list of edition ids." }, { status: 400 });
  }

  const editionIds = Array.isArray(payload.editionIds)
    ? [...new Set(payload.editionIds.filter((value): value is string => typeof value === "string" && value.length > 0))].slice(0, MAX_EDITION_IDS)
    : [];
  if (!editionIds.length) return Response.json({ listings: [] });

  const admin = getSupabaseAdmin();
  const [{ data: editionsData }, { data: profileData }] = await Promise.all([
    admin.from("manga_editions").select("id,title,series,volume_number,isbn_13").in("id", editionIds),
    admin
      .from("marketplace_search_profiles")
      .select("id,edition_id,source:sources!inner(name)")
      .in("edition_id", editionIds)
      .eq("is_active", true)
      .eq("source.name", "eBay Sold"),
  ]);

  const editionsById = new Map((editionsData ?? []).map((edition) => [edition.id, edition]));
  const profiles = (profileData ?? []) as unknown as Array<{ id: string; edition_id: string }>;
  const editionIdByProfileId = new Map(profiles.map((profile) => [profile.id, profile.edition_id]));
  const profileIds = profiles.map((profile) => profile.id);
  if (!profileIds.length) return Response.json({ listings: [] });

  const now = new Date();
  const nowIso = now.toISOString();
  const freshnessCutoff = new Date(now.getTime() - FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
  const { data: leadData } = await admin
    .from("scout_listing_leads")
    .select("id,profile_id,review_status,source_listing_url,listing_title,listing_price,currency,item_end_at,last_seen_at,raw_payload")
    .in("profile_id", profileIds)
    .in("review_status", ["new", "watching"])
    .gte("last_seen_at", freshnessCutoff)
    .or(`item_end_at.gt.${nowIso},item_end_at.is.null`)
    .order("item_end_at", { ascending: true, nullsFirst: false })
    .limit(50);

  const listings = ((leadData ?? []) as LiveLead[]).flatMap((lead) => {
    const editionId = editionIdByProfileId.get(lead.profile_id);
    const edition = editionId ? editionsById.get(editionId) : null;
    if (!edition) return [];
    if (lead.review_status !== "watching" && !isPlausibleLiveListing(lead, edition)) return [];
    return [{
      id: lead.id,
      editionId: edition.id,
      editionTitle: edition.title,
      editionSeries: edition.series,
      editionVolumeNumber: edition.volume_number,
      sourceListingUrl: lead.source_listing_url,
      listingTitle: lead.listing_title,
      listingPrice: lead.listing_price,
      currency: lead.currency,
      itemEndAt: lead.item_end_at,
      rawPayload: lead.raw_payload,
    }];
  }).slice(0, 12);

  return Response.json({ listings });
}
