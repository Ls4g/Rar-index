import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import PublicHeader from "@/components/PublicHeader";
import { dedupeLiveListings, isPlausibleLiveListing } from "@/lib/liveListings";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import "@/app/public-redesign.css";

export const dynamic = "force-dynamic";

type Lead = {
  id: string; external_id: string | null; profile_id: string; review_status: string;
  source_listing_url: string; listing_title: string; listing_price: number | null;
  currency: string | null; item_end_at: string | null; last_seen_at: string;
};
type Profile = { id: string; edition_id: string; is_active: boolean; source: { name: string } | null };
type Edition = {
  id: string; title: string | null; series: string | null; volume_number: string | null;
  language: string | null; publisher: string | null; format: string | null; isbn_13: string | null;
  cover_image_url: string | null; cover_verification_status: string | null;
};

function askingPrice(price: number | null, currency: string | null) {
  if (price === null || !currency) return "Asking price unavailable";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(price); }
  catch { return `${price} ${currency}`; }
}

export default async function BuyMangaPage() {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data: leadData, error } = await admin.from("scout_listing_leads")
    .select("id,external_id,profile_id,review_status,source_listing_url,listing_title,listing_price,currency,item_end_at,last_seen_at")
    .in("review_status", ["new", "watching"]).gte("last_seen_at", cutoff)
    .or(`item_end_at.gt.${now.toISOString()},item_end_at.is.null`)
    .order("last_seen_at", { ascending: false }).limit(1000);
  const leads = (leadData ?? []) as Lead[];
  const profileIds = [...new Set(leads.map((lead) => lead.profile_id))];
  const { data: profileData } = profileIds.length ? await admin.from("marketplace_search_profiles")
    .select("id,edition_id,is_active,source:sources!inner(name)").in("id", profileIds)
    .eq("is_active", true).eq("source.name", "eBay Sold") : { data: [] };
  const profiles = (profileData ?? []) as unknown as Profile[];
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const editionIds = [...new Set(profiles.map((profile) => profile.edition_id))];
  const { data: editionData } = editionIds.length ? await admin.from("manga_editions")
    .select("id,title,series,volume_number,language,publisher,format,isbn_13,cover_image_url,cover_verification_status")
    .in("id", editionIds).eq("is_verified", true) : { data: [] };
  const editionById = new Map(((editionData ?? []) as Edition[]).map((edition) => [edition.id, edition]));
  const perEdition = new Map<string, number>();
  const visible = dedupeLiveListings(leads.filter((lead) => {
    const profile = profileById.get(lead.profile_id);
    const edition = profile && editionById.get(profile.edition_id);
    return Boolean(edition && (lead.review_status === "watching" || isPlausibleLiveListing(lead, edition)));
  })).filter((lead) => {
    const editionId = profileById.get(lead.profile_id)!.edition_id;
    const count = perEdition.get(editionId) ?? 0;
    if (count >= 5) return false;
    perEdition.set(editionId, count + 1);
    return true;
  }).slice(0, 100);

  return <main className="public-page buy-redesign">
    <PublicHeader />
    <section className="buy-redesign-hero">
      <div><p className="buy-redesign-kicker">BUY MANGA</p><h1>Find a copy worth a closer look.</h1><p>These are recently seen eBay listings linked to RAR editions. Prices below are sellers’ asking prices, never completed-sale evidence or a valuation. Open the source to check availability before buying.</p></div>
      <strong>{visible.length} recently seen</strong>
    </section>
    <section className="buy-redesign-content">
      {error ? <p>Listings could not be loaded right now. Please try again later.</p> : visible.length ? <div className="buy-redesign-grid">{visible.map((lead) => {
        const profile = profileById.get(lead.profile_id)!;
        const edition = editionById.get(profile.edition_id)!;
        return <article className="buy-redesign-card" key={lead.id}>
          <Link className="buy-redesign-cover" href={`/edition/${edition.id}`}><EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} /></Link>
          <div><p>{edition.language} · {edition.series || edition.title} {edition.volume_number ? `· Vol. ${edition.volume_number}` : ""}</p><h2>{lead.listing_title}</h2><strong>{askingPrice(lead.listing_price, lead.currency)} <small>asking</small></strong><span>Seen by Scout {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(lead.last_seen_at))}</span><div className="buy-redesign-actions"><a href={lead.source_listing_url} target="_blank" rel="noopener noreferrer">Check listing ↗</a><Link href={`/edition/${edition.id}`}>Edition details</Link></div></div>
        </article>;
      })}</div> : <div className="buy-redesign-empty"><h2>No recently seen listings yet.</h2><p>Scout has not found a current match that passes the public checks. The catalogue is still open to explore.</p><Link href="/browse">Browse manga ↗</Link></div>}
      <p className="buy-redesign-note">Showing up to five recently seen leads per edition. Listings can sell or be removed after Scout sees them; RAR does not sell these copies and cannot guarantee availability or an exact print match.</p>
    </section>
  </main>;
}
