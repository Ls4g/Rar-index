import MangaSearch, { type Manga } from "@/components/MangaSearch";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { editionDescriptor, publisherDisplayName } from "@/lib/editionDisplay";
import { formatListingEnd, isPlausibleLiveListing, listingType } from "@/lib/liveListings";

// Catalogue updates should appear without waiting for the next deployment.
export const dynamic = "force-dynamic";

function formatSalePrice(value: number, code: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

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
  const [{ data, error }, { count }, { count: evidenceCount }, { count: firstPrintCount }, { data: allCatalogue }, { data: verifiedSales }] = await Promise.all([
    supabase
    .from("manga_editions")
    .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name, collectible_type, cover_image_url, cover_verification_status")
    .eq("is_verified", true)
    .not("isbn_13", "is", null)
    .not("publisher", "is", null)
    .not("release_date", "is", null)
    .order("created_at", { ascending: false })
    .limit(6),
    supabase
      .from("manga_editions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true)
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null),
    supabase
      .from("alpha_catalogue_v1")
      .select("id", { count: "exact", head: true })
      .gt("verified_sale_count", 0),
    supabase
      .from("alpha_catalogue_v1")
      .select("id", { count: "exact", head: true })
      .eq("printing_number", 1),
    supabase
      .from("manga_editions")
      .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name, collectible_type, cover_image_url, cover_verification_status")
      .eq("is_verified", true)
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null)
      .limit(500),
    supabase
      .from("price_observations")
      .select("edition_id")
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
      .limit(1000),
  ]);

  const manga = (data ?? []) as Manga[];
  const saleCounts = new Map<string, number>();
  for (const sale of verifiedSales ?? []) {
    saleCounts.set(sale.edition_id, (saleCounts.get(sale.edition_id) ?? 0) + 1);
  }
  const pricedEditions = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => saleCounts.has(String(edition.id)))
    .sort((a, b) => (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0))
    .slice(0, 6);

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
      .select("id,title,series,volume_number,language,isbn_13,edition_statement,printing_number,variant_name,collectible_type,cover_image_url,cover_verification_status")
      .in("id", marketEditionIds)
    : { data: [] };
  const marketEditionsById = new Map(((marketEditionsData ?? []) as Manga[]).map((edition) => [String(edition.id), edition]));

  const recentSalesWithEdition = recentSales.flatMap((sale) => {
    const edition = marketEditionsById.get(sale.edition_id);
    return edition ? [{ sale, edition }] : [];
  });

  const liveOpportunities = liveLeads
    .flatMap((lead) => {
      const editionId = editionIdByProfileId.get(lead.profile_id);
      const edition = editionId ? marketEditionsById.get(editionId) : null;
      if (!edition || !isPlausibleLiveListing(lead, edition)) return [];
      return [{ lead, edition }];
    })
    .slice(0, 6);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </a>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/identify">Identify a copy</Link>
          <Link className="header-note" href="/browse">Browse editions</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
        </nav>
      </header>

      <section id="top" className="hero">
        <div className="hero-grid" />
        <div className="hero-content">
          <p className="eyebrow">Manga collecting, made legible</p>
          <h1>
            Know what you own.
            <span>Find what matters.</span>
          </h1>
          <p className="hero-copy">
            RAR Index is building the reference point for manga editions,
            market history and collector knowledge.
          </p>
          <MangaSearch />
        </div>
      </section>

      <section className="index-section market-evidence-section" aria-labelledby="market-evidence-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start with evidence</p>
            <h2 id="market-evidence-heading">Editions with verified prices</h2>
          </div>
          <span>{evidenceCount ?? pricedEditions.length} edition{(evidenceCount ?? pricedEditions.length) === 1 ? "" : "s"} with confirmed sale evidence</span>
        </div>

        {pricedEditions.length > 0 ? (
          <>
            <p className="section-copy market-evidence-copy">Every sale links back to its original source. RAR only uses a sale in a valuation after its edition match has been verified.</p>
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
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="index-section-action"><Link href="/browse?evidence=verified-sales">Browse editions with verified prices →</Link></div>
          </>
        ) : (
          <div className="status-message">RAR is reviewing its first sale sources. Catalogue entries never receive a price until the source and edition match are confirmed.</div>
        )}
      </section>

      <section className="index-section" aria-labelledby="recent-sales-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent activity</p>
            <h2 id="recent-sales-heading">Recent verified sales</h2>
          </div>
          <span>Completed marketplace sales RAR has proven match an exact edition</span>
        </div>

        {recentSalesWithEdition.length ? (
          <div className="manga-grid">
            {recentSalesWithEdition.map(({ sale, edition }, index) => (
              <Link className="manga-card" href={`/edition/${edition.id}`} key={`${edition.id}-${sale.sold_date}-${sale.sale_price}`}>
                <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="card-cover" priority={index < 3} />
                <div className="card-body">
                  <p className="card-kicker">{formatSalePrice(sale.sale_price, sale.currency)} · {formatSaleDate(sale.sold_date)}</p>
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
          <div className="status-message">No verified sales have been recorded yet. Sales appear here only once RAR proves a listing matches an exact edition.</div>
        )}
      </section>

      <section className="index-section live-listings-section" aria-labelledby="live-opportunities-heading">
        <div className="section-heading live-listings-intro">
          <div>
            <p className="eyebrow">RAR Scout</p>
            <h2 id="live-opportunities-heading">Live buying opportunities</h2>
          </div>
          <span className="live-listings-status">Current listings, not completed sales</span>
        </div>
        <p className="section-copy">These are active eBay listings whose title clearly matches a catalogue edition. They are buying opportunities only and never affect RAR&apos;s verified-sale counts or market value.</p>
        {liveOpportunities.length ? (
          <div className="live-listings-grid">
            {liveOpportunities.map(({ lead, edition }) => (
              <a className="live-listing-card" href={lead.source_listing_url} target="_blank" rel="noreferrer" key={lead.id}>
                <div>
                  <span>{listingType(lead.raw_payload)} · eBay · {[edition.series || edition.title, edition.volume_number ? `Vol. ${edition.volume_number}` : null].filter(Boolean).join(" ")}</span>
                  <h3>{lead.listing_title}</h3>
                </div>
                <div className="live-listing-meta">
                  <strong>{lead.listing_price !== null && lead.currency ? formatSalePrice(lead.listing_price, lead.currency) : "Price not listed"}</strong>
                  <small>Ends {formatListingEnd(lead.item_end_at)}</small>
                </div>
              </a>
            ))}
          </div>
        ) : (
          <div className="live-listings-empty">
            <strong>No current listings from RAR Scout</strong>
            <p>Live opportunities appear here once Scout finds an active listing whose title clearly matches a catalogue edition and volume.</p>
          </div>
        )}
      </section>

      <section className="index-section" aria-labelledby="new-additions-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The RAR Index</p>
            <h2 id="new-additions-heading">Recently documented editions</h2>
          </div>
          <span>{count ?? manga.length} catalogue-ready edition{(count ?? manga.length) === 1 ? "" : "s"} indexed</span>
        </div>

        {error ? (
          <div className="status-message" role="alert">
            We could not load the manga index right now. Please try again shortly.
          </div>
        ) : manga.length > 0 ? (
          <>
            <div className="manga-grid">
              {manga.slice(0, 3).map((item, index) => (
                <Link className="manga-card" href={`/edition/${item.id}`} key={item.id}>
                  <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="card-cover" priority={index < 3} />
                  <div className="card-body">
                    <p className="card-kicker">{[item.collectible_type?.replaceAll("_", " "), item.volume_number ? `Vol. ${item.volume_number}` : null, item.language].filter(Boolean).join(" · ") || "Manga edition"}</p>
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
                      <div>
                        <dt>Publisher</dt>
                        <dd>{publisherDisplayName(item.publisher)}</dd>
                      </div>
                    </dl>
                  </div>
                </Link>
              ))}
            </div>
            <div className="index-section-action"><Link href="/browse">Browse all catalogue-ready editions →</Link></div>
          </>
        ) : (
          <div className="status-message">
            The index is ready for its first manga entries.
          </div>
        )}
      </section>

      <section className="index-explore" aria-labelledby="explore-index-heading">
        <div className="section-intro">
          <p className="eyebrow">Start with what you need</p>
          <h2 id="explore-index-heading">Explore the index</h2>
          <p className="section-copy">Choose a useful starting point, then follow the original evidence behind every record.</p>
        </div>
        <div className="index-explore-grid">
          <Link href="/browse"><span>Catalogue</span><strong>Browse all {count ?? manga.length} editions</strong><small>Search by title, publisher, language or ISBN.</small></Link>
          <Link href="/browse?evidence=verified-sales"><span>Market evidence</span><strong>{evidenceCount ?? 0} editions with verified sales</strong><small>See only editions with confirmed matching sale evidence.</small></Link>
          <Link href="/browse?printing=first"><span>Printing research</span><strong>{firstPrintCount ?? 0} first-print records</strong><small>Check the record and its linked source before relying on a printing claim.</small></Link>
          <a href="#recent-sales-heading"><span>Recent activity</span><strong>{recentSalesWithEdition.length} recent verified sale{recentSalesWithEdition.length === 1 ? "" : "s"}</strong><small>See the latest completed sales RAR has proven match an exact edition.</small></a>
          <a href="#live-opportunities-heading"><span>RAR Scout</span><strong>{liveOpportunities.length} live buying opportunit{liveOpportunities.length === 1 ? "y" : "ies"}</strong><small>Active listings whose title clearly matches a catalogue edition.</small></a>
          <a href="#new-additions-heading"><span>New research</span><strong>Recently documented editions</strong><small>See the newest records added to the growing catalogue.</small></a>
        </div>
      </section>

      <section className="collector-pathways" aria-labelledby="collector-pathways-heading">
        <div className="section-intro">
          <p className="eyebrow">Start with the question</p>
          <h2 id="collector-pathways-heading">Research with RAR</h2>
          <p className="section-copy">A collector should be able to identify an item, understand the evidence, then decide what a recorded sale actually means.</p>
        </div>
        <div className="collector-pathway-list">
          <Link href="/identify">
            <span>01</span>
            <div><strong>Identify a copy</strong><p>Use the copyright page and identifiers before calling something a first print.</p></div>
            <b>→</b>
          </Link>
          <Link href="/browse">
            <span>02</span>
            <div><strong>Browse verified editions</strong><p>Search the growing catalogue by title, language, publisher, ISBN, or collectible type.</p></div>
            <b>→</b>
          </Link>
          <Link href="/request-edition">
            <span>03</span>
            <div><strong>Request a missing edition</strong><p>Send RAR a sourced lead for review. A request never becomes a record automatically.</p></div>
            <b>→</b>
          </Link>
        </div>
      </section>

      <section className="principle-section">
        <p className="eyebrow">Built for collectors</p>
        <p>
          Database first. Price history next. Intelligence on top.
        </p>
      </section>

      <footer>
        <span>RAR Index</span>
        <span>Collectible intelligence, beginning with manga.</span>
      </footer>
    </main>
  );
}
