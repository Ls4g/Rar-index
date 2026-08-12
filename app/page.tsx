import MangaSearch, { type Manga } from "@/components/MangaSearch";
import CollectorShelf, { type ShelfEdition } from "@/components/CollectorShelf";
import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { editionDescriptor, evidenceStatusLabel, publisherDisplayName } from "@/lib/editionDisplay";
import { formatListingEndLabel, isPlausibleLiveListing, listingType } from "@/lib/liveListings";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import { HomeMarketCurrencyControl, HomePrice } from "@/components/HomeMarketDisplay";
import type { FxRate } from "@/lib/fx";

// Catalogue updates should appear without waiting for the next deployment.
export const dynamic = "force-dynamic";

function formatSaleDate(value: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
type RecentSale = {
  edition_id: string;
  sale_price: number;
  currency: string;
  sold_date: string | null;
};

type LiveLead = {
  id: string;
  profile_id: string;
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  item_end_at: string | null;
  raw_payload: unknown;
};

export default async function Home() {
  // Every count and card here is scoped to publications (record_kind =
  // 'publication') — a proven print-run record (e.g. a first printing) is
  // never a separate destination or a separate line in a counter; its
  // evidence already rolls up into its publication via
  // publication_print_readiness.
  const [{ count }, { count: evidenceCount }, { count: firstPrintCount }, { data: allCatalogue }, { data: readinessRows }] = await Promise.all([
    supabase
      .from("manga_editions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null),
    supabase
      .from("publication_print_readiness")
      .select("publication_id", { count: "exact", head: true })
      .gt("total_verified_sale_count", 0),
    supabase
      .from("publication_print_readiness")
      .select("publication_id", { count: "exact", head: true })
      .eq("has_first_print_evidence", true),
    supabase
      .from("manga_editions")
      .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name, collectible_type, cover_image_url, cover_verification_status")
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null)
      .limit(500),
    supabase
      .from("publication_print_readiness")
      .select("publication_id,first_print_proven_sale_count,total_verified_sale_count,has_first_print_evidence"),
  ]);

  const readinessById = new Map((readinessRows ?? []).map((row) => [row.publication_id, row]));
  const saleCounts = new Map<string, number>();
  for (const [publicationId, row] of readinessById) saleCounts.set(publicationId, row.total_verified_sale_count);
  // Best-documented first: a verified cover alongside a verified sale is
  // what actually makes a record useful to a collector browsing right now,
  // so it outranks a higher sale count with no confirmed cover art.
  const pricedRanked = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => (saleCounts.get(String(edition.id)) ?? 0) > 0)
    .sort((a, b) => {
      const coverRank = Number(b.cover_verification_status === "verified") - Number(a.cover_verification_status === "verified");
      if (coverRank !== 0) return coverRank;
      return (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0);
    });
  // Evidence clusters on a handful of series, and the same volume is often
  // catalogued in two languages -- so a straight top-six filled six slots
  // with four series, showing Black Clover and Jujutsu Kaisen twice each.
  // Take the strongest edition per series first, then backfill from what is
  // left if there are fewer series than slots. This changes which of RAR's
  // priced publications are shown, never how many exist: the count beside
  // the heading still comes straight from the evidence table.
  const HOMEPAGE_PRICED_SLOTS = 6;
  const seriesKey = (edition: Manga) => (edition.series || edition.title || String(edition.id)).toLowerCase().replace(/[^a-z0-9]/g, "");
  const seenSeries = new Set<string>();
  const oneEachSeries = pricedRanked.filter((edition) => {
    const key = seriesKey(edition);
    if (seenSeries.has(key)) return false;
    seenSeries.add(key);
    return true;
  });
  const pricedEditions = [
    ...oneEachSeries,
    ...pricedRanked.filter((edition) => !oneEachSeries.includes(edition)),
  ].slice(0, HOMEPAGE_PRICED_SLOTS);
  // First-print watch reuses the same catalogue fetch — no new query, just a
  // different lens on data RAR already verified: a publication with at
  // least one sale proven a first print via direct copyright-page evidence,
  // never merely inferred from a release date or an edition's own name.
  const firstPrintWatch = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => readinessById.get(String(edition.id))?.has_first_print_evidence)
    .sort((a, b) => {
      const coverRank = Number(b.cover_verification_status === "verified") - Number(a.cover_verification_status === "verified");
      if (coverRank !== 0) return coverRank;
      return (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0);
    })
    .slice(0, 4);

  // The collector's shelf: verified covers only, sale-evidenced ones first.
  // Latest-sale figures are the raw original sale amount (no FX conversion
  // or median math) — the same "or latest verified sale" alternative the
  // edition page itself offers when there isn't yet enough for a median.
  const shelfCandidates = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => edition.cover_verification_status === "verified")
    .sort((a, b) => (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0))
    .slice(0, 16);
  const shelfEditionIds = shelfCandidates.map((edition) => String(edition.id));
  // A publication's sales can live on a proven print-run child record (e.g.
  // One Piece Japanese Vol. 1's first-print sales are on its child, not the
  // publication row itself) — pull in those children so the shelf's "latest
  // sale" figure reflects the whole publication, not just its own row.
  const { data: shelfChildrenData } = shelfEditionIds.length
    ? await supabase.from("manga_editions").select("id,printing_of_edition_id").in("printing_of_edition_id", shelfEditionIds)
    : { data: [] };
  const shelfPublicationByChildId = new Map((shelfChildrenData ?? []).map((child) => [child.id, child.printing_of_edition_id as string]));
  const shelfFamilyIds = [...shelfEditionIds, ...shelfPublicationByChildId.keys()];
  const { data: shelfSalesData } = shelfFamilyIds.length
    ? await supabase
      .from("price_observations")
      .select("edition_id, sale_price, currency, sold_date")
      .in("edition_id", shelfFamilyIds)
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
      .order("sold_date", { ascending: false })
    : { data: [] };
  const latestSaleByEdition = new Map<string, { price: number; currency: string; soldDate: string | null }>();
  for (const sale of (shelfSalesData ?? []) as RecentSale[]) {
    const publicationId = shelfPublicationByChildId.get(sale.edition_id) ?? sale.edition_id;
    if (!latestSaleByEdition.has(publicationId)) {
      latestSaleByEdition.set(publicationId, { price: sale.sale_price, currency: sale.currency, soldDate: sale.sold_date });
    }
  }
  const shelfEditions: ShelfEdition[] = shelfCandidates.map((edition) => ({
    id: String(edition.id),
    title: edition.title,
    series: edition.series,
    volumeNumber: edition.volume_number,
    language: edition.language,
    editionLabel: editionDescriptor(edition),
    coverImageUrl: edition.cover_image_url,
    coverStatus: edition.cover_verification_status,
    verifiedSaleCount: saleCounts.get(String(edition.id)) ?? 0,
    latestSale: latestSaleByEdition.get(String(edition.id)) ?? null,
  }));

  // A recent-sales activity feed and live buying opportunities, both drawn
  // across the whole catalogue rather than one edition at a time.
  const admin = getSupabaseAdmin();
  const [{ data: recentSalesData }, { data: liveProfileData }] = await Promise.all([
    supabase
      .from("price_observations")
      .select("edition_id, sale_price, currency, sold_date")
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
      .order("sold_date", { ascending: false })
      .limit(8),
    admin
      .from("marketplace_search_profiles")
      .select("id,edition_id,source:sources!inner(name)")
      .eq("is_active", true)
      .eq("source.name", "eBay Sold"),
  ]);

  const recentSales = (recentSalesData ?? []) as RecentSale[];
  const liveProfiles = (liveProfileData ?? []) as unknown as Array<{ id: string; edition_id: string }>;
  const editionIdByProfileId = new Map(liveProfiles.map((profile) => [profile.id, profile.edition_id]));
  const liveProfileIds = liveProfiles.map((profile) => profile.id);
  const liveListingNowDate = new Date();
  const liveListingNow = liveListingNowDate.toISOString();
  const liveListingFreshnessCutoff = new Date(liveListingNowDate.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data: liveLeadData } = liveProfileIds.length
    ? await admin
      .from("scout_listing_leads")
      .select("id,profile_id,source_listing_url,listing_title,listing_price,currency,item_end_at,last_seen_at,raw_payload")
      .in("profile_id", liveProfileIds)
      .in("review_status", ["new", "watching"])
      .gte("last_seen_at", liveListingFreshnessCutoff)
      .or("item_end_at.gt." + liveListingNow + ",item_end_at.is.null")
      .order("item_end_at", { ascending: true, nullsFirst: false })
      .limit(100)
    : { data: [] };
  const liveLeads = (liveLeadData ?? []) as LiveLead[];

  const marketEditionIds = [...new Set([
    ...recentSales.map((sale) => sale.edition_id),
    ...liveLeads.flatMap((lead) => {
      const editionId = editionIdByProfileId.get(lead.profile_id);
      return editionId ? [editionId] : [];
    }),
  ])];
  const { data: marketEditionsData } = marketEditionIds.length
    ? await supabase
      .from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,format,isbn_13,edition_statement,printing_number,variant_name,collectible_type,cover_image_url,cover_verification_status,printing_of_edition_id")
      .in("id", marketEditionIds)
    : { data: [] };
  const marketEditionsById = new Map(((marketEditionsData ?? []) as Array<Manga & { printing_of_edition_id: string | null }>).map((edition) => [String(edition.id), edition]));

  // A sale or live profile can be attached directly to a proven print-run
  // record rather than its publication — link straight to the publication
  // instead of relying on /edition/[id]'s redirect for every homepage card.
  function publicationLink(edition: { id: string | number; printing_of_edition_id: string | null }) {
    return `/edition/${edition.printing_of_edition_id ?? edition.id}`;
  }

  const recentSalesWithEdition = recentSales.flatMap((sale) => {
    const edition = marketEditionsById.get(sale.edition_id);
    return edition ? [{ sale, edition }] : [];
  });

  // The same real eBay listing can be captured by more than one search
  // profile (e.g. two catalogue editions of the same volume). Dedupe on the
  // underlying item so it is never shown twice as separate "opportunities".
  const seenListings = new Set<string>();
  const liveOpportunities = liveLeads
    .flatMap((lead) => {
      const editionId = editionIdByProfileId.get(lead.profile_id);
      const edition = editionId ? marketEditionsById.get(editionId) : null;
      if (!edition || !isPlausibleLiveListing(lead, edition)) return [];
      const listingKey = lead.source_listing_url.match(/\/itm\/(\d+)/)?.[1] ?? lead.source_listing_url;
      if (seenListings.has(listingKey)) return [];
      seenListings.add(listingKey);
      return [{ lead, edition }];
    })
    .slice(0, 6);

  // All homepage prices use one visitor-selected display currency. Sales are
  // converted with their sale-date ECB reference rate; active listings use
  // the latest available reference rate without changing the stored amount.
  const { data: homepageFxRatesData } = await supabase
    .from("exchange_rates")
    .select("rate_date,currency,rate_per_eur,source_name,source_url")
    .order("rate_date", { ascending: true })
    .limit(1000);
  const homepageFxRates = (homepageFxRatesData ?? []) as FxRate[];
  const homepageListingRateDate = new Date().toISOString().slice(0, 10);

  return (
    <MarketCurrencyProvider initialCurrency="USD">
    <main className="public-page home-page">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </a>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/identify">First-print check</Link>
          <Link className="header-note" href="/browse">Browse manga</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
          <Link className="header-note" href="/staff-login">Staff access</Link>
          <HomeMarketCurrencyControl />
          <ThemeToggle />
        </nav>
      </header>

      <section id="top" className="hero">
        <div className="hero-grid" />
        <div className="hero-content">
          <p className="eyebrow">Manga price &amp; printing research</p>
          <h1>
            What&apos;s your manga
            <span>actually worth?</span>
          </h1>
          <p className="hero-copy">
            RAR tracks real completed sales of specific manga editions — so you
            know what your copies are worth, and whether yours is a first print.
          </p>
          <MangaSearch />
          {/* Three plain steps, directly under the search. First-time visitors
              were reading the old abstract hero and guessing the site was a
              card tracker; this states the job in the visitor's own words
              before they have to interpret anything else on the page. */}
          <ol className="hero-steps">
            <li><span>1</span>Search your manga</li>
            <li><span>2</span>See what real copies sold for</li>
            <li><span>3</span>Check if yours is a first print</li>
          </ol>
        </div>

        {/* The shelf is the most collector-ish thing on the page, so it now
            follows the search directly instead of sitting behind another
            block of navigation. The entry points move below it: they are
            wayfinding, and do not need to precede the collection itself. */}
        {shelfEditions.length ? (
          <div className="collector-shelf-section">
            <div className="collector-shelf-heading">
              <p className="eyebrow">The collector&apos;s shelf</p>
            </div>
            <CollectorShelf editions={shelfEditions} rates={homepageFxRates} />
          </div>
        ) : null}

        <div className="hero-entry-points">
          <Link className="is-primary" href="/browse?evidence=verified-sales">Browse sold prices</Link>
          <Link className="is-live" href="#live-opportunities-heading">See what&apos;s on sale now</Link>
          <Link href="/identify">Is mine a first print?</Link>
        </div>
      </section>

      <section className="index-section market-evidence-section" aria-labelledby="market-evidence-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">What copies actually sell for</p>
            <h2 id="market-evidence-heading">Manga with real sold prices</h2>
          </div>
          <span>{evidenceCount ?? pricedEditions.length} manga with confirmed sold prices</span>
        </div>

        {pricedEditions.length > 0 ? (
          <>
            <p className="section-copy market-evidence-copy">Every price here comes from a sale that actually completed, with a working link back to the original listing — never an asking price. A sale only counts once we have confirmed it was this exact edition.</p>
            <div className="manga-grid">
              {pricedEditions.map((item, index) => {
                const verifiedSaleCount = saleCounts.get(String(item.id)) ?? 0;
                return (
                  <Link className="manga-card priced-edition-card" href={`/edition/${item.id}`} key={item.id}>
                    <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="card-cover" priority={index < 3} />
                    <div className="card-body">
                      <p className="card-kicker">{verifiedSaleCount} verified sale{verifiedSaleCount === 1 ? "" : "s"} · {[item.volume_number ? `Vol. ${item.volume_number}` : null, item.language].filter(Boolean).join(" · ")}</p>
                      <h3>{item.title || "Untitled manga"}</h3>
                      <dl>
                        <div>
                          <dt>Series</dt>
                          <dd>{item.series || "Not yet recorded"}</dd>
                        </div>
                        <div>
                          <dt>Edition</dt>
                          <dd>{editionDescriptor(item)}</dd>
                        </div>
                      </dl>
                      {item.cover_verification_status !== "verified" ? <small className="card-honest-note">Cover not yet confirmed — shown for its sale evidence.</small> : null}
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="index-section-action"><Link href="/browse?collection=best-documented">See the manga we know most about →</Link></div>
          </>
        ) : (
          <div className="status-message">RAR is reviewing its first sale sources. Catalogue entries never receive a price until the source and edition match are confirmed.</div>
        )}
      </section>

      {firstPrintWatch.length ? (
        <section className="index-section first-print-watch-section" aria-labelledby="first-print-watch-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">First-print watch</p>
              <h2 id="first-print-watch-heading">First printings we can prove</h2>
            </div>
            <span>{firstPrintCount ?? firstPrintWatch.length} manga with a proven first printing</span>
          </div>
          <p className="section-copy">A first print is only claimed here when a real copy&apos;s printing line was actually checked — never guessed from a release date or from what the book calls itself. Open any one to see exactly which copy proved it.</p>
          <div className="manga-grid">
            {firstPrintWatch.map((item, index) => {
              const verifiedSaleCount = saleCounts.get(String(item.id)) ?? 0;
              return (
                <Link className="manga-card first-print-card" href={`/edition/${item.id}`} key={item.id}>
                  <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="card-cover" priority={index < 3} />
                  <div className="card-body">
                    <p className="card-kicker">{[item.volume_number ? `Vol. ${item.volume_number}` : null, item.language].filter(Boolean).join(" · ")}</p>
                    <h3>{item.title || "Untitled manga"}</h3>
                    <dl>
                      <div>
                        <dt>Series</dt>
                        <dd>{item.series || "Not yet recorded"}</dd>
                      </div>
                      <div>
                        <dt>Publisher</dt>
                        <dd>{publisherDisplayName(item.publisher)}</dd>
                      </div>
                    </dl>
                    <small className="card-honest-note">{evidenceStatusLabel(item.cover_verification_status === "verified", verifiedSaleCount)}</small>
                  </div>
                </Link>
              );
            })}
          </div>
          <div className="index-section-action"><Link href="/browse?printing=first">See every proven first printing →</Link></div>
        </section>
      ) : null}

      <section className="index-section" aria-labelledby="recent-sales-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2 id="recent-sales-heading">Recently sold</h2>
          </div>
          <span>Completed sales we have matched to an exact edition</span>
        </div>

        {recentSalesWithEdition.length ? (
          <div className="manga-grid">
            {recentSalesWithEdition.map(({ sale, edition }, index) => (
              <Link className="manga-card" href={publicationLink(edition)} key={`${edition.id}-${sale.sold_date}-${sale.sale_price}`}>
                <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="card-cover" priority={index < 3} />
                <div className="card-body">
                  <p className="card-kicker"><HomePrice value={sale.sale_price} sourceCurrency={sale.currency} rateDate={sale.sold_date} rates={homepageFxRates} /> · {formatSaleDate(sale.sold_date)}</p>
                  <h3>{edition.title || "Untitled manga"}</h3>
                  <dl>
                    <div>
                      <dt>Series</dt>
                      <dd>{edition.series || "Not yet recorded"}</dd>
                    </div>
                    <div>
                      <dt>Edition</dt>
                      <dd>{editionDescriptor(edition)}</dd>
                    </div>
                  </dl>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="status-message">No sales recorded yet. A sale only appears here once we have proven it was this exact edition.</div>
        )}
      </section>

      <section className="index-section live-listings-section" aria-labelledby="live-opportunities-heading">
        <div className="section-heading live-listings-intro">
          <div>
            <p className="eyebrow">RAR Scout</p>
            <h2 id="live-opportunities-heading">On sale right now</h2>
          </div>
          <span className="live-listings-status">Listings you can still buy — not sold prices</span>
        </div>
        <p className="section-copy">Active eBay listings whose title clearly matches a manga in the catalogue. These are buying opportunities only — an asking price never counts as a sale and never moves a value on this site.</p>
        {liveOpportunities.length ? (
          <div className="live-listings-grid">
            {liveOpportunities.map(({ lead, edition }) => (
              <a className="live-listing-card" href={lead.source_listing_url} target="_blank" rel="noreferrer" key={lead.id}>
                <div>
                  <span>{listingType(lead.raw_payload)} · eBay · {[edition.series || edition.title, edition.volume_number ? `Vol. ${edition.volume_number}` : null].filter(Boolean).join(" ")}</span>
                  <h3>{lead.listing_title}</h3>
                </div>
                <div className="live-listing-meta">
                  <strong>{lead.listing_price !== null && lead.currency ? <HomePrice value={lead.listing_price} sourceCurrency={lead.currency} rateDate={homepageListingRateDate} rates={homepageFxRates} /> : "Price not listed"}</strong>
                  {formatListingEndLabel(lead.item_end_at) ? <small>{formatListingEndLabel(lead.item_end_at)}</small> : null}
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="live-listings-empty">
            <strong>Nothing on sale right now</strong>
            <p>Listings appear here as soon as Scout finds an active one whose title clearly matches a manga and volume in the catalogue.</p>
          </div>
        )}
      </section>

      {/* The homepage used to end in four more blocks — a "recently added"
          grid of records with no cover and no sale, an eight-tile explore
          wall, a three-step pathway list, and a slogan panel. Between them
          they answered "what is this site" four different ways, which is
          why first-time visitors could not answer it at all. One slim row
          of destinations replaces the lot; nothing is orphaned, because
          every page they linked to still has an entry here. */}
      <section className="index-ways-in" aria-labelledby="ways-in-heading">
        <h2 id="ways-in-heading" className="sr-only">More ways into the catalogue</h2>
        <div className="index-ways-in-grid">
          <Link href="/browse"><strong>Browse everything</strong><small>All {count ?? 0} manga in the catalogue</small></Link>
          <Link href="/collection"><strong>Track your collection</strong><small>See how far through each series you are</small></Link>
          <Link href="/identify"><strong>Is mine a first print?</strong><small>Check your copy&apos;s printing line, step by step</small></Link>
          <Link href="/request-edition"><strong>Missing something?</strong><small>Send us a manga to research and add</small></Link>
        </div>
      </section>

      <footer>
        <span>RAR Index</span>
        <span>Real sold prices and printing research, for manga collectors.</span>
      </footer>
    </main>
    </MarketCurrencyProvider>
  );
}
