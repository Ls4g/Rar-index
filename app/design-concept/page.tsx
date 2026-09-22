import type { Metadata } from "next";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import type { FxRate } from "@/lib/fx";
import type { SeriesSale } from "@/lib/priceSeries";
import { supabase } from "@/lib/supabase";
import "./style.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "RAR design concept",
  robots: { index: false, follow: false },
};

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

export default async function DesignConceptPage() {
  const [{ data: catalogueData }, { data: saleData }] = await Promise.all([
    supabase.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,cover_image_url,cover_verification_status")
      .eq("is_verified", true).eq("record_kind", "publication")
      .eq("cover_verification_status", "verified").not("cover_image_url", "is", null)
      .limit(500),
    supabase.from("price_observations")
      .select("edition_id,source_listing_url,sold_date,sale_price,currency,grading_company,grade_label,match_status,print_classification,known_printing_number")
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
  const heroEdition = featured.find((edition) => edition.series?.toLowerCase() === "one piece") ?? null;
  const showcaseCovers = featured.slice(0, 10);

  return (
    <MarketCurrencyProvider initialCurrency="GBP">
      <main className="rar-concept">
        <div className="rar-concept-previewbar">
          <span>RAR design concept · built as a real responsive page</span>
          <Link href="/">Current RAR ↗</Link>
        </div>
        <header className="rar-concept-header">
          <Link className="rar-concept-logo" href="#home" aria-label="RAR concept home"><b>R</b><span>RAR</span><small>INDEX</small></Link>
          <nav aria-label="Concept sections">
            <a href="#browse">Discover</a><a href="#edition">Edition</a><a href="#showcase">Collections</a><a href="#buy">Buy manga</a>
          </nav>
          <a className="rar-concept-header-cta" href="#join">Your shelf <span>↗</span></a>
        </header>

        <section className="rar-concept-hero rar-concept-container" id="home">
          <div className="rar-concept-hero-copy">
            <p className="rar-concept-kicker">THE HOME FOR MANGA COLLECTORS</p>
            <h1>Track your manga.<br /><em>Show off your collection.</em></h1>
            <p>Build a shelf around the exact editions you own. Follow their market with sales you can trace back to the source.</p>
            <div className="rar-concept-actions">
              <a className="rar-concept-button is-primary" href="#join">Start your shelf <span>↗</span></a>
              <a className="rar-concept-button is-secondary" href="#browse">Explore manga</a>
            </div>
          </div>
          {heroEdition ? <div className="rar-concept-hero-feature" aria-label="Featured manga edition">
            <div className="rar-concept-hero-feature-ink" aria-hidden="true" />
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
              <aside aria-label="Catalogue categories"><p>EXPLORE</p><a href="#browse" aria-current="page">Featured manga</a><a href="#showcase">Collector shelves</a><a href="#edition">Sales history</a><a href="#buy">Available copies</a><span>{featured.length} covers in this preview</span></aside>
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
          <div className="rar-concept-showcase-intro"><div><p className="rar-concept-kicker">PUBLIC PORTFOLIOS</p><h2>A collection worth looking at.</h2><p>Your favourite covers take centre stage. Visitors can explore the exact editions behind them.</p></div><span>Display preview using catalogue covers<br />No collector ownership implied</span></div>
          <div className="rar-concept-showcase-grid">{showcaseCovers.map((edition) => <Link href={`/edition/${edition.id}`} key={edition.id}>{cover(edition)}<strong>{editionName(edition)}</strong><span>{editionMeta(edition)}</span></Link>)}</div>
          <Link className="rar-concept-showcase-action" href="/collection">Explore public collections ↗</Link>
        </div></section>

        <section className="rar-concept-buy rar-concept-container" id="buy"><div><p className="rar-concept-kicker">BUY MANGA</p><h2>See the edition. Then find a copy.</h2><p>Browse copies listed for sale, with their asking prices clearly separate from completed sales.</p></div><Link href={product ? `/edition/${product.id}` : "/browse"}>View available copies ↗</Link></section>

        <section className="rar-concept-join" id="join"><div className="rar-concept-join-wall" aria-hidden="true">{showcaseCovers.map((edition) => <div key={edition.id}>{cover(edition)}</div>)}</div><div className="rar-concept-join-copy"><p className="rar-concept-kicker">YOUR COLLECTION STARTS HERE</p><h2>Build your shelf.</h2><p>Track every edition you own and choose what the world gets to see.</p><Link className="rar-concept-button is-primary" href="/portfolio">Open your collection <span>↗</span></Link></div></section>
      </main>
    </MarketCurrencyProvider>
  );
}
