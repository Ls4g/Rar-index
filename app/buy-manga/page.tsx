import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import PublicHeader from "@/components/PublicHeader";
import { matchesBuyMangaFilters, sortBuyMangaItems, type BuyMangaFilters, type BuyMangaSort } from "@/lib/buyMangaSearch";
import { dedupeLiveListings, isPlausibleLiveListing } from "@/lib/liveListings";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import "@/app/public-redesign.css";

export const dynamic = "force-dynamic";

const DB_PAGE_SIZE = 1000;
const MAX_RECENT_LEADS = 10000;
const RESULTS_PER_PAGE = 24;

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
type BuyMangaPageParams = { q?: string | string[]; language?: string | string[]; currency?: string | string[]; maxPrice?: string | string[]; sort?: string | string[]; page?: string | string[] };

function one(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function pageUrl(filters: BuyMangaFilters, page: number) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  if (filters.language) params.set("language", filters.language);
  if (filters.currency) params.set("currency", filters.currency);
  if (filters.maxPrice !== null) params.set("maxPrice", String(filters.maxPrice));
  if (filters.sort !== "recent") params.set("sort", filters.sort);
  if (page > 1) params.set("page", String(page));
  return `/buy-manga${params.size ? `?${params.toString()}` : ""}`;
}

function askingPrice(price: number | null, currency: string | null) {
  if (price === null || !currency) return "Asking price unavailable";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(price); }
  catch { return `${price} ${currency}`; }
}

export default async function BuyMangaPage({ searchParams }: { searchParams: Promise<BuyMangaPageParams> }) {
  const parameters = await searchParams;
  const admin = getSupabaseAdmin();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const loadLeadPage = (start: number) => admin.from("scout_listing_leads")
    .select("id,external_id,profile_id,review_status,source_listing_url,listing_title,listing_price,currency,item_end_at,last_seen_at", { count: "exact" })
    .in("review_status", ["new", "watching"]).gte("last_seen_at", cutoff)
    .or(`item_end_at.gt.${now.toISOString()},item_end_at.is.null`)
    .order("last_seen_at", { ascending: false }).range(start, start + DB_PAGE_SIZE - 1);
  const firstPage = await loadLeadPage(0);
  const totalRecentLeads = firstPage.count ?? 0;
  const pageStarts = Array.from({ length: Math.max(0, Math.ceil(Math.min(totalRecentLeads, MAX_RECENT_LEADS) / DB_PAGE_SIZE) - 1) }, (_, index) => (index + 1) * DB_PAGE_SIZE);
  const extraPages = firstPage.error ? [] : await Promise.all(pageStarts.map(loadLeadPage));
  const leadError = firstPage.error || extraPages.find((page) => page.error)?.error;
  const leads = [firstPage, ...extraPages].flatMap((page) => (page.data ?? []) as Lead[]);
  const profileIds = [...new Set(leads.map((lead) => lead.profile_id))];
  const profilePages = await Promise.all(Array.from({ length: Math.ceil(profileIds.length / 150) }, (_, index) =>
    admin.from("marketplace_search_profiles")
      .select("id,edition_id,is_active,source:sources!inner(name)")
      .in("id", profileIds.slice(index * 150, (index + 1) * 150))
      .eq("is_active", true).eq("source.name", "eBay Sold")));
  const profiles = profilePages.flatMap((page) => (page.data ?? []) as unknown as Profile[]);
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const editionIds = [...new Set(profiles.map((profile) => profile.edition_id))];
  const editionPages = await Promise.all(Array.from({ length: Math.ceil(editionIds.length / 150) }, (_, index) =>
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,format,isbn_13,cover_image_url,cover_verification_status")
      .in("id", editionIds.slice(index * 150, (index + 1) * 150)).eq("is_verified", true)));
  const editionById = new Map(editionPages.flatMap((page) => (page.data ?? []) as Edition[]).map((edition) => [edition.id, edition]));
  const error = leadError || profilePages.find((page) => page.error)?.error || editionPages.find((page) => page.error)?.error;
  const candidates = leads.flatMap((lead) => {
    const profile = profileById.get(lead.profile_id);
    const edition = profile && editionById.get(profile.edition_id);
    return edition && (lead.review_status === "watching" || isPlausibleLiveListing(lead, edition)) ? [{ lead, edition }] : [];
  });
  const languages = [...new Set(candidates.map(({ edition }) => edition.language).filter((value): value is string => Boolean(value)))].sort();
  const currencies = [...new Set(candidates.map(({ lead }) => lead.currency).filter((value): value is string => Boolean(value)))].sort();
  const defaultCurrency = currencies.length === 1 && candidates.every(({ lead }) => lead.currency === currencies[0]) ? currencies[0] : "";
  const requestedCurrency = one(parameters.currency);
  const currency = requestedCurrency === "all" ? "" : currencies.includes(requestedCurrency) ? requestedCurrency : defaultCurrency;
  const rawMaxPrice = one(parameters.maxPrice);
  const parsedMaxPrice = Number(rawMaxPrice);
  const maxPrice = rawMaxPrice && Number.isFinite(parsedMaxPrice) && parsedMaxPrice > 0 ? parsedMaxPrice : null;
  const requestedSort = one(parameters.sort);
  const sort: BuyMangaSort = currency && (requestedSort === "price_asc" || requestedSort === "price_desc") ? requestedSort : "recent";
  const filters: BuyMangaFilters = {
    query: one(parameters.q).trim().slice(0, 100),
    language: languages.includes(one(parameters.language)) ? one(parameters.language) : "",
    currency,
    maxPrice,
    sort,
  };
  const sorted = sortBuyMangaItems(candidates.filter((item) => matchesBuyMangaFilters(item, filters)), filters.sort, filters.currency);
  const deduped = dedupeLiveListings(sorted.map((item) => ({ ...item, external_id: item.lead.external_id, source_listing_url: item.lead.source_listing_url })));
  const perEdition = new Map<string, number>();
  const matched = deduped.filter(({ edition }) => {
    const count = perEdition.get(edition.id) ?? 0;
    if (count >= 5) return false;
    perEdition.set(edition.id, count + 1);
    return true;
  });
  const requestedPage = Number(one(parameters.page));
  const totalPages = Math.max(1, Math.ceil(matched.length / RESULTS_PER_PAGE));
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
  const visible = matched.slice((currentPage - 1) * RESULTS_PER_PAGE, currentPage * RESULTS_PER_PAGE);
  const filtered = Boolean(filters.query || filters.language || filters.maxPrice !== null || filters.sort !== "recent" || filters.currency !== defaultCurrency);

  return <main className="public-page buy-redesign">
    <PublicHeader />
    <section className="buy-redesign-hero">
      <div><p className="buy-redesign-kicker">BUY MANGA</p><h1>Find a copy worth a closer look.</h1><p>These are recently seen eBay listings linked to RAR editions. Prices below are sellers’ asking prices, never completed-sale evidence or a valuation. Open the source to check availability before buying.</p></div>
      <strong>{matched.length} recently seen</strong>
    </section>
    <section className="buy-redesign-content">
      <form action="/buy-manga" className="buy-redesign-filters" method="get" role="search">
        <label className="buy-redesign-search">Search manga or listing<input autoComplete="off" defaultValue={filters.query} name="q" placeholder="Try One Piece, Vol. 1, or a listing title" type="search" /></label>
        <label>Language<select defaultValue={filters.language} name="language"><option value="">All languages</option>{languages.map((language) => <option key={language} value={language}>{language}</option>)}</select></label>
        <label>Currency<select defaultValue={currency || "all"} name="currency"><option value="all">All currencies</option>{currencies.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Maximum asking price<input defaultValue={maxPrice ?? ""} inputMode="decimal" min="0" name="maxPrice" placeholder="Any price" step="0.01" type="number" /></label>
        <label>Sort by<select defaultValue={sort} name="sort"><option value="recent">Recently seen</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option></select></label>
        <div className="buy-redesign-filter-actions"><button type="submit">Show listings</button><Link href="/buy-manga">Clear</Link></div>
      </form>
      {maxPrice !== null && !currency ? <p className="buy-redesign-filter-hint">Choose a currency to apply the price limit; different currencies are not compared.</p> : null}
      {!currency && (requestedSort === "price_asc" || requestedSort === "price_desc") ? <p className="buy-redesign-filter-hint">Choose a currency to sort by price; different currencies are not compared.</p> : null}
      {totalRecentLeads > MAX_RECENT_LEADS ? <p className="buy-redesign-filter-hint">Search currently covers the {MAX_RECENT_LEADS.toLocaleString()} most recently seen leads. Older leads may not appear.</p> : null}
      {!error && matched.length ? <p className="buy-redesign-result-count">Showing {(currentPage - 1) * RESULTS_PER_PAGE + 1}–{(currentPage - 1) * RESULTS_PER_PAGE + visible.length} of {matched.length} matching listings</p> : null}
      {error ? <p>Listings could not be loaded right now. Please try again later.</p> : visible.length ? <div className="buy-redesign-grid">{visible.map(({ lead, edition }) => {
        return <article className="buy-redesign-card" key={lead.id}>
          <Link className="buy-redesign-cover" href={`/edition/${edition.id}`}><EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} /></Link>
          <div><p>{edition.language} · {edition.series || edition.title} {edition.volume_number ? `· Vol. ${edition.volume_number}` : ""}</p><h2>{lead.listing_title}</h2><strong>{askingPrice(lead.listing_price, lead.currency)} <small>asking</small></strong><span>Seen by Scout {new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(lead.last_seen_at))}</span><div className="buy-redesign-actions"><a href={lead.source_listing_url} target="_blank" rel="noopener noreferrer">Check listing ↗</a><Link href={`/edition/${edition.id}`}>Edition details</Link></div></div>
        </article>;
      })}</div> : <div className="buy-redesign-empty"><h2>{filtered ? "No listings match those filters." : "No recently seen listings yet."}</h2><p>{filtered ? "Try a broader title, language or price range." : "Scout has not found a current match that passes the public checks. The catalogue is still open to explore."}</p><Link href={filtered ? "/buy-manga" : "/browse"}>{filtered ? "Clear filters ↗" : "Browse manga ↗"}</Link></div>}
      {!error && totalPages > 1 ? <nav aria-label="Buy manga pages" className="buy-redesign-pagination">
        {currentPage > 1 ? <Link href={pageUrl(filters, currentPage - 1)}>← Previous</Link> : <span />}
        <span>Page {currentPage} of {totalPages}</span>
        {currentPage < totalPages ? <Link href={pageUrl(filters, currentPage + 1)}>Next →</Link> : <span />}
      </nav> : null}
      <p className="buy-redesign-note">Showing up to five recently seen leads per edition. Prices are seller asking prices in the displayed currency; the price filter never converts currencies. Listings can sell or be removed after Scout sees them; RAR does not sell these copies and cannot guarantee availability or an exact print match.</p>
    </section>
  </main>;
}
