import MangaSearch, { type Manga } from "@/components/MangaSearch";
import CoverWall, { type WallCover } from "@/components/CoverWall";
import HomeShelfPanel from "@/components/HomeShelfPanel";
import SaleSparkline, { type SalePoint } from "@/components/SaleSparkline";
import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { editionDescriptor, evidenceStatusLabel, publisherDisplayName } from "@/lib/editionDisplay";
import { formatListingEndLabel, isPlausibleLiveListing, listingType } from "@/lib/liveListings";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import { HomeMarketCurrencyControl, HomePrice } from "@/components/HomeMarketDisplay";
import { comparisonGroup, type FxRate } from "@/lib/fx";

// The homepage is ordered around the collection, not the price.
//
// Tracking a shelf is why anyone turns up; tracking is what generates the
// evidence; the evidence is the part nobody else has. So the shelf leads, the
// catalogue follows, and valuation arrives once there is something to value.
//
// Every count and card here is scoped to publications (record_kind =
// 'publication') — a proven print-run record (e.g. a first printing) is never
// a separate destination or a separate line in a counter; its evidence already
// rolls up into its publication via publication_print_readiness.
export const dynamic = "force-dynamic";

// Enough covers for the wall to loop on real variety without shipping the
// whole catalogue's artwork to a first-time visitor.
const WALL_COVER_LIMIT = 72;
const FEATURE_MIN_SALES = 3;

function formatSaleDate(value: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function homepageTitle(edition: Manga) {
  return (edition.collectible_type === "zasshi" ? edition.series : edition.title) || "Untitled publication";
}

function homepageIssueLabel(edition: Manga) {
  if (edition.collectible_type !== "zasshi") return null;
  return [edition.issue_year, edition.issue_number_label ? `Issue ${edition.issue_number_label}` : null].filter(Boolean).join(" · ") || "Magazine issue";
}

function homepageDescriptor(edition: Manga) {
  return edition.collectible_type === "zasshi" ? homepageIssueLabel(edition) : editionDescriptor(edition);
}

type RecentSale = {
  edition_id: string;
  sale_price: number;
  currency: string;
  sold_date: string | null;
};

// The featured chart needs the grading columns as well, because raw and
// graded are separate markets and must never be drawn as one line.
type FeatureSale = RecentSale & { grading_company: string | null; grade_label: string | null };

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
  const [{ count }, { count: evidenceCount }, { count: firstPrintCount }, { data: allCatalogue }, { data: readinessRows }] = await Promise.all([
    supabase
      .from("manga_editions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .or("collectible_type.eq.zasshi,isbn_13.not.is.null")
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
      .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name, collectible_type, cover_image_url, cover_verification_status, issue_year, issue_number_label, cumulative_issue_no, madb_id")
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .or("collectible_type.eq.zasshi,isbn_13.not.is.null")
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

  const seriesKey = (edition: Manga) => (edition.series || edition.title || String(edition.id)).toLowerCase().replace(/[^a-z0-9]/g, "");

  // Best-documented first: a verified cover alongside a verified sale is what
  // actually makes a record useful to a collector browsing right now, so it
  // outranks a higher sale count with no confirmed cover art.
  const pricedRanked = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => (saleCounts.get(String(edition.id)) ?? 0) > 0)
    .sort((a, b) => {
      const coverRank = Number(b.cover_verification_status === "verified") - Number(a.cover_verification_status === "verified");
      if (coverRank !== 0) return coverRank;
      return (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0);
    });
  // Evidence clusters on a handful of series, and the same volume is often
  // catalogued in two languages — so a straight top-six filled six slots with
  // four series. Take the strongest edition per series first, then backfill.
  // This changes which of RAR's priced publications are shown, never how many
  // exist: the count beside the heading still comes from the evidence table.
  const HOMEPAGE_PRICED_SLOTS = 6;
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
  // different lens on data RAR already verified: a publication with at least
  // one sale proven a first print via direct copyright-page evidence, never
  // merely inferred from a release date or from an edition's own name.
  const firstPrintWatch = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => readinessById.get(String(edition.id))?.has_first_print_evidence)
    .sort((a, b) => {
      const coverRank = Number(b.cover_verification_status === "verified") - Number(a.cover_verification_status === "verified");
      if (coverRank !== 0) return coverRank;
      return (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0);
    })
    .slice(0, 4);

  const verifiedCoverCandidates = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => edition.cover_verification_status === "verified" && edition.cover_image_url)
    .sort((a, b) => (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0));

  // The wall is interleaved by series, not taken in catalogue order. RAR's
  // verified covers cluster heavily — eighteen One Piece, eleven Bleach —
  // so reading them in order fills the first screen with one title and makes
  // a wall of variety look like a wall of Dragon Ball.
  const coversBySeries = new Map<string, Manga[]>();
  for (const edition of verifiedCoverCandidates) {
    const key = seriesKey(edition);
    coversBySeries.set(key, [...(coversBySeries.get(key) ?? []), edition]);
  }
  const coverQueues = [...coversBySeries.values()];
  const wallCovers: WallCover[] = [];
  const seenCoverUrls = new Set<string>();
  for (let round = 0; wallCovers.length < WALL_COVER_LIMIT; round += 1) {
    let added = false;
    for (const queue of coverQueues) {
      if (wallCovers.length >= WALL_COVER_LIMIT) break;
      const item = queue[round];
      if (item?.cover_image_url && !seenCoverUrls.has(item.cover_image_url)) {
        seenCoverUrls.add(item.cover_image_url);
        wallCovers.push({ url: item.cover_image_url, label: item.series ?? item.title ?? "" });
        added = true;
      }
    }
    if (!added) break;
  }

  // A publication's sales can live on a proven print-run child record (e.g.
  // One Piece Japanese Vol. 1's first-print sales are on its child, not the
  // publication row itself) — pull in those children so a publication's
  // evidence is read whole rather than from its own row alone.
  const featureCandidates = verifiedCoverCandidates.filter((edition) => (saleCounts.get(String(edition.id)) ?? 0) >= FEATURE_MIN_SALES).slice(0, 12);
  const featureIds = featureCandidates.map((edition) => String(edition.id));
  const { data: featureChildrenData } = featureIds.length
    ? await supabase.from("manga_editions").select("id,printing_of_edition_id").in("printing_of_edition_id", featureIds)
    : { data: [] };
  const featurePublicationByChildId = new Map((featureChildrenData ?? []).map((child) => [child.id, child.printing_of_edition_id as string]));
  const featureFamilyIds = [...featureIds, ...featurePublicationByChildId.keys()];
  const { data: featureSalesData } = featureFamilyIds.length
    ? await supabase
      .from("price_observations")
      .select("edition_id, sale_price, currency, sold_date, grading_company, grade_label")
      .in("edition_id", featureFamilyIds)
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
      .not("sold_date", "is", null)
      .order("sold_date", { ascending: true })
    : { data: [] };

  // The featured chart obeys the same rule every edition page does: raw and
  // graded are different markets and are never drawn as one line, and a run
  // of prices in mixed currencies is not a trend. So a publication only
  // qualifies on a cluster of at least three sales sharing both a comparison
  // group and a currency — otherwise no chart is shown at all.
  const featureClusters = new Map<string, FeatureSale[]>();
  for (const sale of (featureSalesData ?? []) as FeatureSale[]) {
    const publicationId = featurePublicationByChildId.get(sale.edition_id) ?? sale.edition_id;
    const key = `${publicationId}::${comparisonGroup(sale).key}::${sale.currency}`;
    featureClusters.set(key, [...(featureClusters.get(key) ?? []), sale]);
  }
  const bestCluster = [...featureClusters.entries()]
    .filter(([, rows]) => rows.length >= FEATURE_MIN_SALES)
    .sort((left, right) => right[1].length - left[1].length)[0];
  const feature = bestCluster
    ? (() => {
      const [key, rows] = bestCluster;
      const [publicationId, group] = key.split("::");
      const edition = featureCandidates.find((candidate) => String(candidate.id) === publicationId);
      if (!edition) return null;
      const sorted = [...rows].sort((left, right) => String(left.sold_date).localeCompare(String(right.sold_date)));
      return { edition, rows: sorted, latest: sorted[sorted.length - 1], group };
    })()
    : null;
  const featurePoints: SalePoint[] = feature
    ? feature.rows.map((sale) => ({
      date: String(sale.sold_date),
      price: Number(sale.sale_price),
      currency: sale.currency,
      graded: Boolean(sale.grading_company || sale.grade_label),
    }))
    : [];

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
      .select("id,title,series,volume_number,language,publisher,format,isbn_13,edition_statement,printing_number,variant_name,collectible_type,cover_image_url,cover_verification_status,printing_of_edition_id,issue_year,issue_number_label,cumulative_issue_no,madb_id")
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

  // The same real eBay listing can be captured by more than one search profile
  // (e.g. two catalogue editions of the same volume). Dedupe on the underlying
  // item so it is never shown twice as separate "opportunities".
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
  // converted with their sale-date ECB reference rate; active listings use the
  // latest available reference rate without changing the stored amount.
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
          <Link className="header-note" href="/browse">Browse manga</Link>
          <Link className="header-note" href="/identify">First-print check</Link>
          <Link className="header-note" href="/portfolio">My shelf</Link>
          <Link className="header-note" href="/staff-login">Staff access</Link>
          <HomeMarketCurrencyControl />
          <ThemeToggle />
        </nav>
      </header>

      {/* ------------------------------------------------------------- hero */}
      {/* The shelf is the hero: the thing the visitor came to build, not a
          valuation question. The wall beside it is RAR's own verified cover
          art, so it argues the catalogue has depth without claiming any of it
          belongs to the person looking. */}
      <section className="home-hero" id="top">
        <div className="home-hero-copy">
          <p className="eyebrow">Manga collection tracker</p>
          <h1>Track your manga, <mark>show off your collection</mark></h1>
          <p className="home-lede">
            Add what you own, see what you are missing, and put the whole thing on a page worth sending to
            someone. RAR knows the exact edition — publisher, ISBN, printing — not just the title.
          </p>
          <MangaSearch />
          <div className="home-actions">
            <Link className="home-btn" href="/portfolio">Start your shelf</Link>
            <Link className="home-btn is-quiet" href="/browse?evidence=verified-sales">Browse sold prices</Link>
          </div>
          <p className="home-edge">
            {count ?? 0} publications catalogued · {evidenceCount ?? 0} with completed sales · every price linked to its receipt
          </p>
        </div>
        <div className="home-hero-wall" aria-hidden="true">
          <CoverWall covers={wallCovers} />
        </div>
      </section>

      {/* ------------------------------------------------------------ shelf */}
      {/* Real holdings for whoever is signed in, and an invitation for
          everyone else. Never a sample collection dressed as theirs. */}
      <HomeShelfPanel />

      {/* ------------------------------------------------------------ worth */}
      {/* Second, deliberately. The edge that makes RAR hard to copy, offered
          as what you get once a shelf exists — not as the opening pitch. */}
      <section className="index-section home-worth-section" aria-labelledby="market-evidence-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">What copies actually sell for</p>
            <h2 id="market-evidence-heading">Manga with real sold prices</h2>
          </div>
          <span>{evidenceCount ?? pricedEditions.length} manga with confirmed sold prices</span>
        </div>
        <p className="section-copy market-evidence-copy">Every price here comes from a sale that actually completed, with a working link back to the original listing — never an asking price. A sale only counts once we have confirmed it was this exact edition.</p>

        {feature ? (
          <article className="home-feature">
            <div className="home-feature-object">
              <EditionCover
                className="home-feature-cover"
                imageStatus={feature.edition.cover_verification_status}
                imageUrl={feature.edition.cover_image_url}
                language={feature.edition.language}
                priority
                series={feature.edition.series}
                title={feature.edition.title}
                volumeNumber={feature.edition.volume_number}
              />
            </div>
            <div className="home-feature-body">
              <p className="eyebrow">{[feature.edition.language, publisherDisplayName(feature.edition.publisher)].filter(Boolean).join(" · ")}</p>
              <h3><Link href={`/edition/${feature.edition.id}`}>{homepageTitle(feature.edition)}</Link></h3>
              <p className="home-feature-descriptor">{homepageDescriptor(feature.edition)}</p>
              <p className="home-figure">
                <HomePrice rateDate={feature.latest.sold_date} rates={homepageFxRates} sourceCurrency={feature.latest.currency} value={feature.latest.sale_price} />
              </p>
              <p className="home-feature-delta">Last verified sale · {formatSaleDate(feature.latest.sold_date)}</p>
              <SaleSparkline height={166} points={featurePoints} rates={homepageFxRates} width={560} />
              {/* The chart is drawn from one comparison group in one currency,
                  which is the only way a line between sales means anything.
                  Saying so is not a caveat — it is what the chart is. */}
              <p className="home-chart-note">
                {featurePoints.length} verified {feature.group.toLowerCase().startsWith("graded") ? feature.group.toLowerCase() : "raw"} sales,
                all recorded in {feature.latest.currency}, each linked to its receipt. Points sit at their real dates, so uneven
                months look uneven, and the line stays straight between sales because RAR does not know what happened in between.
              </p>
            </div>
          </article>
        ) : null}

        {pricedEditions.length > 0 ? (
          <>
            <div className="manga-grid">
              {pricedEditions.map((item, index) => {
                const verifiedSaleCount = saleCounts.get(String(item.id)) ?? 0;
                return (
                  <Link className="manga-card priced-edition-card" href={`/edition/${item.id}`} key={item.id}>
                    <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} descriptor={item.collectible_type === "zasshi" ? homepageIssueLabel(item) : null} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="card-cover" priority={index < 3} />
                    <div className="card-body">
                      <p className="card-kicker">{verifiedSaleCount} verified sale{verifiedSaleCount === 1 ? "" : "s"} · {[(item.collectible_type === "zasshi" ? homepageIssueLabel(item) : item.volume_number ? `Vol. ${item.volume_number}` : null), item.language].filter(Boolean).join(" · ")}</p>
                      <h3>{homepageTitle(item)}</h3>
                      <dl>
                        <div>
                          <dt>{item.collectible_type === "zasshi" ? "Magazine" : "Series"}</dt>
                          <dd>{item.series || "Not yet recorded"}</dd>
                        </div>
                        <div>
                          <dt>Edition</dt>
                          <dd>{homepageDescriptor(item)}</dd>
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

      {/* ------------------------------------------------------------ share */}
      <section className="index-section home-share-section" aria-labelledby="home-share-heading">
        <div className="home-share">
          <div className="home-share-copy">
            <p className="eyebrow">Show it off</p>
            <h2 id="home-share-heading">A shelf worth sending</h2>
            <p className="section-copy">
              Claim a handle and your shelf gets its own page at <code>/collectors/yourhandle</code>. It carries your
              covers and which exact editions you own — never what you paid, when you bought it, or any note you wrote.
              Shelves stay private until you publish one, and an unpublished handle returns nothing rather than
              confirming it exists.
            </p>
            <div className="home-actions">
              <Link className="home-btn" href="/portfolio">Start your shelf</Link>
            </div>
          </div>
          <ul className="home-share-facts">
            <li><strong>Public</strong><span>Covers, series and the exact editions on your shelf.</span></li>
            <li><strong>Private</strong><span>Purchase prices, dates, quantities and your notes.</span></li>
          </ul>
        </div>
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
            {firstPrintWatch.map((item) => {
              const verifiedSaleCount = saleCounts.get(String(item.id)) ?? 0;
              return (
                <Link className="manga-card first-print-card" href={`/edition/${item.id}`} key={item.id}>
                  <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="card-cover" />
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
            {recentSalesWithEdition.map(({ sale, edition }) => (
              <Link className="manga-card" href={publicationLink(edition)} key={`${edition.id}-${sale.sold_date}-${sale.sale_price}`}>
                <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} descriptor={edition.collectible_type === "zasshi" ? homepageIssueLabel(edition) : null} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="card-cover" />
                <div className="card-body">
                  <p className="card-kicker"><HomePrice value={sale.sale_price} sourceCurrency={sale.currency} rateDate={sale.sold_date} rates={homepageFxRates} /> · {formatSaleDate(sale.sold_date)}</p>
                  <h3>{homepageTitle(edition)}</h3>
                  <dl>
                    <div>
                      <dt>{edition.collectible_type === "zasshi" ? "Magazine" : "Series"}</dt>
                      <dd>{edition.series || "Not yet recorded"}</dd>
                    </div>
                    <div>
                      <dt>Edition</dt>
                      <dd>{homepageDescriptor(edition)}</dd>
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
        <p className="section-copy">Active eBay listings whose title clearly matches a publication in the catalogue. These are buying opportunities only — an asking price never counts as a sale and never moves a value on this site.</p>
        {liveOpportunities.length ? (
          <div className="live-listings-grid">
            {liveOpportunities.map(({ lead, edition }) => (
              <a className="live-listing-card" href={lead.source_listing_url} target="_blank" rel="noreferrer" key={lead.id}>
                <div>
                  <span>{listingType(lead.raw_payload)} · eBay · {[edition.series || edition.title, edition.collectible_type === "zasshi" ? homepageIssueLabel(edition) : edition.volume_number ? `Vol. ${edition.volume_number}` : null].filter(Boolean).join(" ")}</span>
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
            <p>Listings appear here as soon as Scout finds an active one whose title clearly matches a manga volume or magazine issue in the catalogue.</p>
          </div>
        )}
      </section>

      <section className="index-ways-in" aria-labelledby="ways-in-heading">
        <h2 id="ways-in-heading" className="sr-only">More ways into the catalogue</h2>
        <div className="index-ways-in-grid">
          <Link href="/browse"><strong>Browse everything</strong><small>All {count ?? 0} publications in the catalogue</small></Link>
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
