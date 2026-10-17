import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import EditionCover from "@/components/EditionCover";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import type { FxRate } from "@/lib/fx";
import type { SeriesSale } from "@/lib/priceSeries";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { selectHomeLiveListings, type HomeListingCard, type HomeListingEdition, type HomeListingLead, type HomeListingProfile } from "@/lib/homeLiveListings";
import HomeLiveListingsRail from "@/components/HomeLiveListingsRail";
import "@/app/design-concept/style.css";

type ConceptEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

type ConceptSale = SeriesSale & {
  edition_id: string;
  source_listing_url: string;
  match_status: string;
};

const preferredSeries = [
  "One Piece", "Hunter x Hunter", "Dragon Ball", "Naruto", "Berserk", "Bleach",
  "Jujutsu Kaisen", "Chainsaw Man", "Slam Dunk", "Black Clover", "Demon Slayer",
  "Attack on Titan", "Fullmetal Alchemist", "Kagurabachi", "Frieren",
];

function cover(edition: ConceptEdition, className = "") {
  return <EditionCover
    className={className}
    imageStatus={edition.cover_verification_status}
    imageUrl={edition.cover_image_url}
    language={edition.language}
    series={edition.series}
    title={edition.title}
    volumeNumber={edition.volume_number}
  />;
}

function editionName(edition: ConceptEdition) {
  return edition.series || edition.title || "Manga edition";
}

function editionMeta(edition: ConceptEdition) {
  return [edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.publisher]
    .filter(Boolean).join(" · ");
}

async function getHomeLiveListings(): Promise<HomeListingCard[]> {
  const admin = getSupabaseAdmin();
  const now = new Date();
  const cutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data: leadData, error: leadError } = await admin.from("scout_listing_leads")
    .select("id,external_id,profile_id,review_status,source_listing_url,listing_title,listing_price,currency,item_end_at,last_seen_at")
    .in("review_status", ["new", "watching"]).gte("last_seen_at", cutoff)
    .or(`item_end_at.gt.${now.toISOString()},item_end_at.is.null`)
    .order("last_seen_at", { ascending: false }).limit(300);
  if (leadError || !leadData?.length) return [];
  const leads = leadData as HomeListingLead[];
  const profileIds = [...new Set(leads.map((lead) => lead.profile_id))];
  const profilePages = await Promise.all(Array.from({ length: Math.ceil(profileIds.length / 150) }, (_, index) =>
    admin.from("marketplace_search_profiles").select("id,edition_id,is_active,source:sources!inner(name)")
      .in("id", profileIds.slice(index * 150, (index + 1) * 150))
      .eq("is_active", true).eq("source.name", "eBay Sold")));
  if (profilePages.some((page) => page.error)) return [];
  const profiles = profilePages.flatMap((page) => (page.data ?? []) as unknown as HomeListingProfile[]);
  const editionIds = [...new Set(profiles.map((profile) => profile.edition_id))];
  if (!editionIds.length) return [];
  const editionPages = await Promise.all(Array.from({ length: Math.ceil(editionIds.length / 150) }, (_, index) =>
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,format,isbn_13,cover_image_url,cover_verification_status")
      .in("id", editionIds.slice(index * 150, (index + 1) * 150))
      .eq("is_verified", true).eq("record_kind", "publication")
      .eq("cover_verification_status", "verified").not("cover_image_url", "is", null)));
  if (editionPages.some((page) => page.error)) return [];
  const editions = editionPages.flatMap((page) => (page.data ?? []) as HomeListingEdition[]);
  return selectHomeLiveListings(leads, profiles, editions, now);
}

export default async function ConceptExperience({ preview = false }: { preview?: boolean }) {
  const liveListingsPromise = getHomeLiveListings();
  const [{ data: catalogueData }, { data: saleData }] = await Promise.all([
    supabase.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,cover_image_url,cover_verification_status")
      .eq("is_verified", true).eq("record_kind", "publication")
      .eq("cover_verification_status", "verified").not("cover_image_url", "is", null)
      .limit(500),
    supabase.from("price_observations")
      .select("id,edition_id,source_listing_url,sold_date,sale_price,currency,listing_title,grading_company,grade_label,grading_reviewed_at,match_status,print_classification,known_printing_number")
      .eq("sale_status", "confirmed").eq("match_status", "verified_match")
      .not("source_listing_url", "is", null).order("sold_date", { ascending: false }).limit(500),
  ]);

  const catalogue = (catalogueData ?? []) as ConceptEdition[];
  const allSales = (saleData ?? []) as ConceptSale[];
  const withCovers = catalogue.filter((row) => row.cover_image_url);
  const gallery = [...withCovers].sort((a, b) => {
    const rank = (row: ConceptEdition) => preferredSeries.findIndex((name) => row.series?.toLowerCase() === name.toLowerCase());
    const left = rank(a); const right = rank(b);
    return (left < 0 ? 999 : left) - (right < 0 ? 999 : right);
  });
  const seen = new Set<string>();
  const featured = gallery.filter((edition) => {
    const key = (edition.series || edition.title || edition.id).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
  const saleCount = new Map<string, number>();
  for (const sale of allSales) saleCount.set(sale.edition_id, (saleCount.get(sale.edition_id) ?? 0) + 1);
  const product = [...gallery].sort((a, b) => (saleCount.get(b.id) ?? 0) - (saleCount.get(a.id) ?? 0))[0] ?? null;
  const productSales = product ? allSales.filter((sale) => sale.edition_id === product.id) : [];
  const { data: rateData } = await supabase.from("exchange_rates")
    .select("rate_date,currency,rate_per_eur,source_name,source_url")
    .order("rate_date", { ascending: true }).limit(1000);
  const rates = (rateData ?? []) as FxRate[];
  const { data: spotlightSelection } = preview ? { data: null } : await getSupabaseAdmin()
    .from("homepage_feature_selections").select("edition_id")
    .eq("slot", "edition_of_week").order("selected_at", { ascending: false }).limit(1).maybeSingle();
  const heroEdition = gallery.find((edition) => edition.id === spotlightSelection?.edition_id)
    ?? featured.find((edition) => edition.series?.toLowerCase() === "one piece") ?? featured[0] ?? null;
  const heroSketch = heroEdition?.series?.toLowerCase() === "dragon ball"
    ? "/rar-dragon-ball-hero-sketch-clean.png"
    : heroEdition?.series?.toLowerCase() === "one piece"
      ? "/rar-one-piece-cover-sketch-v2.png" : null;
  const showcaseCovers = featured.slice(0, 10);
  const liveListings = await liveListingsPromise;

  return (
    <MarketCurrencyProvider initialCurrency="GBP">
      <main className="rar-concept">
        {preview ? <div className="rar-concept-previewbar">
          <span>RAR design concept · built as a real responsive page</span>
          <Link href="/">Current RAR ↗</Link>
        </div> : null}
        <header className="rar-concept-header">
          <Link className="rar-concept-logo" href={preview ? "#home" : "/"} aria-label="RAR home"><b>R</b><span>RAR</span><small>INDEX</small></Link>
          <nav aria-label="Main navigation">
            <Link href={preview ? "#browse" : "/browse"}>Discover</Link><Link href={preview ? "#edition" : "/browse?evidence=verified-sales"}>Editions</Link><Link href={preview ? "#showcase" : "/collection"}>Collections</Link><Link href={preview ? "#buy" : "/buy-manga"}>Buy manga</Link>{preview ? null : <Link className="rar-public-header-secondary" href="/staff-login">Staff</Link>}<ThemeToggle />
          </nav>
          <Link className="rar-concept-header-cta" href={preview ? "#join" : "/portfolio"}>Your shelf <span>↗</span></Link>
        </header>

        <section className="rar-concept-hero rar-concept-container" id="home">
          <div className="rar-concept-hero-copy">
            <p className="rar-concept-kicker">THE HOME FOR MANGA COLLECTORS</p>
            <h1>Track your manga.<br /><em>Show off your collection.</em></h1>
            <p>Build a shelf around the exact editions you own. Follow their market with sales you can trace back to the source.</p>
            <form action="/browse" className="rar-concept-hero-search" role="search">
              <label htmlFor="rar-home-search">SEARCH THE CATALOGUE</label>
              <div>
                <input autoComplete="off" id="rar-home-search" name="q" placeholder="Try One Piece, Vol. 2 or an ISBN" type="search" />
                <button type="submit">Explore manga <span aria-hidden="true">↗</span></button>
              </div>
            </form>
            <div className="rar-concept-actions">
              <Link className="rar-concept-button is-primary" href={preview ? "#join" : "/portfolio"}>Start your shelf <span>↗</span></Link>
            </div>
          </div>
          {heroEdition ? <div className="rar-concept-hero-feature" aria-label="Featured manga edition">
            <div className="rar-concept-hero-feature-ink" aria-hidden="true" style={{ backgroundImage: heroSketch ? `url(${heroSketch})` : "none" }} />
            <div className="rar-concept-hero-feature-top"><span>FEATURED EDITION</span><span>RAR / 01</span></div>
            <Link className="rar-concept-hero-feature-book" href={`/edition/${heroEdition.id}`} aria-label={`Explore ${editionName(heroEdition)}, volume ${heroEdition.volume_number}`}>
              {cover(heroEdition)}
            </Link>
            <div className="rar-concept-hero-feature-bottom">
              <div><small>FROM THE RAR CATALOGUE</small><strong>{editionName(heroEdition)}</strong><span>{editionMeta(heroEdition)}</span></div>
              <Link href={`/edition/${heroEdition.id}`}>Explore edition ↗</Link>
            </div>
          </div> : null}
        </section>

        <section className="rar-concept-catalogue" id="browse">
          <div className="rar-concept-container">
            <div className="rar-concept-section-heading">
              <div><p className="rar-concept-kicker">DISCOVER</p><h2>Find the edition that matters to you.</h2></div>
              <Link href="/browse">Browse the full catalogue <span>↗</span></Link>
            </div>
            <div className="rar-concept-browse-layout">
              <aside aria-label="Catalogue categories"><p>EXPLORE</p><a href="#browse" aria-current="page">Featured manga</a><a href="#showcase">Collector shelves</a><a href="#edition">Sales history</a><a href="#buy">Available copies</a><span>{featured.length} {preview ? "covers in this preview" : "featured series"}</span></aside>
              <div className="rar-concept-book-grid">
                {featured.map((edition) => <Link className="rar-concept-book" href={`/edition/${edition.id}`} key={edition.id}>
                  <div className="rar-concept-book-image">{cover(edition)}</div>
                  <strong>{editionName(edition)}</strong><span>{editionMeta(edition)}</span>
                </Link>)}
              </div>
            </div>
          </div>
        </section>

        {product ? <section className="rar-concept-edition rar-concept-container" id="edition">
          <div className="rar-concept-section-heading"><div><p className="rar-concept-kicker">EDITION PAGE</p><h2>The book first. The evidence close behind.</h2></div><Link href={`/edition/${product.id}`}>Open current edition <span>↗</span></Link></div>
          <div className="rar-concept-product-top">
            <div className="rar-concept-product-image">{cover(product)}</div>
            <div className="rar-concept-product-copy">
              <p className="rar-concept-kicker">{product.language?.toUpperCase()} · {product.publisher?.toUpperCase()}</p>
              <h3>{editionName(product)}</h3><p className="rar-concept-product-volume">Volume {product.volume_number || "—"}</p>
              <div className="rar-concept-product-facts"><div><span>EDITION</span><strong>{product.language} publication</strong></div><div><span>VERIFIED SALES</span><strong>{productSales.length} source linked</strong></div></div>
              <Link className="rar-concept-button is-primary" href={`/portfolio?edition=${product.id}`}>Add to your shelf <span>↗</span></Link>
              <Link className="rar-concept-product-link" href={`/edition/${product.id}`}>See full edition details and live copies →</Link>
            </div>
          </div>
          <div className="rar-concept-market">
            <div className="rar-concept-market-heading"><div><p className="rar-concept-kicker">THE MARKET</p><h3>What copies actually sold for</h3></div><span>{productSales.length} verified sales</span></div>
            <PriceHistoryChart rates={rates} sales={productSales} />
            {productSales.length ? <div className="rar-concept-sale-list"><span>RECENT ORIGINAL SOURCES</span>{productSales.slice(0, 3).map((sale, index) => <a href={sale.source_listing_url} key={`${sale.source_listing_url}-${index}`} rel="noopener noreferrer" target="_blank">{new Intl.NumberFormat("en-GB", { style: "currency", currency: sale.currency }).format(sale.sale_price)} <small>{sale.sold_date}</small><b>View source ↗</b></a>)}</div> : null}
          </div>
        </section> : null}

        <section className="rar-concept-showcase" id="showcase"><div className="rar-concept-container">
          <div className="rar-concept-showcase-intro"><div><p className="rar-concept-kicker">SHOW OFF YOUR COLLECTION</p><h2>Give your manga a shelf worth sharing.</h2><p>Choose what other fans can see: your favourite covers, the series you collect, and the exact editions on your shelf.</p></div><Link href="/portfolio">Build your shelf ↗</Link></div>
          <div className="rar-concept-shelf-preview" aria-label="Example of a public manga shelf">
            <div className="rar-concept-shelf-preview-top"><span>EXAMPLE PUBLIC SHELF</span><span>RAR / COLLECTORS</span></div>
            <div className="rar-concept-shelf-preview-person"><span className="rar-concept-shelf-preview-avatar" aria-hidden="true">O</span><div><small>@openingchapter · sample collector</small><strong>The Opening Chapter</strong><p>A few favourite series, shared with fellow manga collectors.</p></div></div>
            <div className="rar-concept-shelf-preview-grid">{showcaseCovers.slice(0, 4).map((edition) => <div key={edition.id}>{cover(edition)}<strong>{editionName(edition)}</strong><span>{editionMeta(edition)}</span></div>)}</div>
            <p className="rar-concept-shelf-preview-note">A visual example using real RAR catalogue covers—not a real person’s collection. Your shelf shows only what you choose to share.</p>
          </div>
        </div></section>

        <section className="rar-concept-buy" id="buy">
          <div className="rar-concept-container rar-concept-buy-heading"><div><p className="rar-concept-kicker">BUY MANGA</p><h2>See the edition. Then find a copy.</h2><p>Browse copies listed for sale, with their asking prices clearly separate from completed sales.</p></div><Link href={preview ? (product ? `/edition/${product.id}` : "/browse") : "/buy-manga"}>View available copies ↗</Link></div>
          {liveListings.length ? <HomeLiveListingsRail listings={liveListings} /> : <p className="rar-concept-buy-empty rar-concept-container">No recently checked copies to show right now. Browse the catalogue while Scout looks for more.</p>}
        </section>

        <section className="rar-concept-join" id="join"><div className="rar-concept-join-wall" aria-hidden="true">{showcaseCovers.map((edition) => <div key={edition.id}>{cover(edition)}</div>)}</div><div className="rar-concept-join-copy"><p className="rar-concept-kicker">YOUR COLLECTION STARTS HERE</p><h2>Build your shelf.</h2><p>Track every edition you own and choose what the world gets to see.</p><Link className="rar-concept-button is-primary" href="/portfolio">Open your collection <span>↗</span></Link></div></section>
      </main>
    </MarketCurrencyProvider>
  );
}
