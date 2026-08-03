import Link from "next/link";
import { notFound } from "next/navigation";
import PriceHistoryChart from "@/components/PriceHistoryChart.tsx/PriceHistoryChart";
import CommunityReportForm from "@/components/CommunityReportForm";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import MarketValuePanel from "@/components/MarketValuePanel";
import EditionCover from "@/components/EditionCover";
import type { FxRate } from "@/lib/fx";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Valuations are live market intelligence, not deployment-time content.
export const dynamic = "force-dynamic";

type EditionPageProps = {
  params: Promise<{ id: string }>;
};

type SourceLink = {
  source_id: string;
  source_record_url: string;
  verification_notes: string | null;
  fields_verified: string[] | null;
};

type Source = { id: string; name: string };

type ObservedSale = {
  source_id: string | null;
  source_listing_url: string | null;
  listing_title: string | null;
  sold_date: string | null;
  sale_price: number;
  currency: string;
  grading_company: string | null;
  grade_label: string | null;
  match_status: "verified_match" | "needs_review" | "excluded";
  raw_payload: unknown;
};

type Metric = {
  currency: string;
  verified_sale_count: number;
  lowest_verified_sale: number;
  market_value_median: number;
  highest_verified_sale: number;
  latest_sale_date: string;
};

type RelatedEdition = {
  id: string;
  title: string | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
};

type LiveListingProfile = {
  id: string;
  last_checked_at: string | null;
};

type LiveListing = {
  id: string;
  profile_id: string;
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  item_end_at: string | null;
  last_seen_at: string;
  raw_payload: unknown;
};

function formatPrice(value: number, code: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

function matchStatusLabel(status: ObservedSale["match_status"]) {
  return status === "verified_match" ? "Edition match verified" : "Edition match under review";
}

function signalLabel(verifiedSales: number, verifiedSources: number) {
  if (verifiedSales >= 6 && verifiedSources >= 3) return "Established evidence";
  if (verifiedSales >= 3 && verifiedSources >= 2) return "Developing evidence";
  return "Early evidence";
}

function formatListingEnd(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function listingType(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Live listing";
  const item = (payload as { item?: unknown }).item;
  if (!item || typeof item !== "object") return "Live listing";
  const options = (item as { buyingOptions?: unknown }).buyingOptions;
  if (!Array.isArray(options)) return "Live listing";
  if (options.includes("AUCTION")) return "Auction";
  if (options.includes("FIXED_PRICE")) return "Buy it now";
  return "Live listing";
}

function readableType(value: string | null) {
  if (!value || value === "tankobon") return "Tankōbon / volume";
  return value.replaceAll("_", " ");
}

function readableTag(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function relatedEditionLabel(edition: RelatedEdition) {
  if (edition.variant_name) return edition.variant_name;
  if (edition.printing_number) {
    const finalTwo = edition.printing_number % 100;
    const suffix = finalTwo >= 11 && finalTwo <= 13 ? "th" : edition.printing_number % 10 === 1 ? "st" : edition.printing_number % 10 === 2 ? "nd" : edition.printing_number % 10 === 3 ? "rd" : "th";
    return `${edition.printing_number}${suffix} printing`;
  }
  return edition.edition_statement || "Standard edition record";
}

function copyrightProofUrl(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const metadata = (payload as { rar_import_metadata?: unknown }).rar_import_metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as { evidence_image_url?: unknown }).evidence_image_url;
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : null;
}

export default async function EditionPage({ params }: EditionPageProps) {
  const { id } = await params;
  const { data: edition } = await supabase
    .from("manga_editions")
    .select(
      "id, title, series, volume_number, author, publisher, imprint, language, country, isbn_10, isbn_13, release_date, format, edition_statement, printing_number, variant_name, historical_notes, importance_tags, is_verified, collectible_type, cover_image_url, cover_source_url, cover_source_name, cover_verification_status"
    )
    .eq("id", id)
    .maybeSingle();

  if (!edition) notFound();

  const relatedEditionsResult = edition.series && edition.volume_number
    ? await supabase
      .from("manga_editions")
      .select("id,title,language,publisher,isbn_13,edition_statement,printing_number,variant_name")
      .eq("series", edition.series)
      .eq("volume_number", edition.volume_number)
      .eq("is_verified", true)
      .neq("id", id)
      .order("language", { ascending: true })
      .limit(6)
    : { data: [] };

  const [sourceLinksResult, observedSalesResult] = await Promise.all([
    supabase
      .from("edition_sources")
      .select("source_id, source_record_url, verification_notes, fields_verified")
      .eq("edition_id", id)
      .order("is_primary", { ascending: false }),
    supabase
      .from("price_observations")
      .select("source_id, source_listing_url, listing_title, sold_date, sale_price, currency, grading_company, grade_label, match_status, raw_payload")
      .eq("edition_id", id)
      .eq("sale_status", "confirmed")
      .neq("match_status", "excluded")
      .order("sold_date", { ascending: false })
      .limit(100),
  ]);

  const sourceLinks = (sourceLinksResult.data ?? []) as SourceLink[];
  const observedSales = (observedSalesResult.data ?? []) as ObservedSale[];
  const verifiedSales = observedSales.filter((sale) => sale.match_status === "verified_match");
  const pendingSales = observedSales.filter((sale) => sale.match_status === "needs_review");
  const rateCurrencies = [...new Set(["GBP", "USD", ...verifiedSales.map((sale) => sale.currency)])];
  const fxRatesResult = rateCurrencies.length
    ? await supabase
      .from("exchange_rates")
      .select("rate_date, currency, rate_per_eur, source_name, source_url")
      .in("currency", rateCurrencies)
      .order("rate_date", { ascending: true })
      .limit(1000)
    : { data: [] };
  const fxRates = (fxRatesResult.data ?? []) as FxRate[];
  const verifiedSourceIds = new Set(verifiedSales.map((sale) => sale.source_id).filter((sourceId): sourceId is string => Boolean(sourceId)));
  const observedSourceIds = new Set(observedSales.map((sale) => sale.source_id).filter((sourceId): sourceId is string => Boolean(sourceId)));
  const latestVerifiedSale = [...verifiedSales].sort((a, b) => (b.sold_date ?? "").localeCompare(a.sold_date ?? ""))[0];
  const sourceIds = [
    ...new Set([
      ...sourceLinks.map((source) => source.source_id),
      ...observedSales.map((sale) => sale.source_id).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const sourcesResult = sourceIds.length
    ? await supabase.from("sources").select("id, name").in("id", sourceIds)
    : { data: [] as Source[] };
  const sourceNames = new Map((sourcesResult.data ?? []).map((source) => [source.id, source.name]));
  const observedSourceNames = [...new Set([...observedSourceIds].map((sourceId) => sourceNames.get(sourceId) ?? "Marketplace").filter(Boolean))];
  const relatedEditions = (relatedEditionsResult.data ?? []) as RelatedEdition[];
  // Kept only to avoid changing the old metric markup in the same release.
  // The rendered valuation now comes from historical conversions below.
  const metrics: Metric[] = [];
  const copyrightProofUrls = [...new Set(observedSales.map((sale) => copyrightProofUrl(sale.raw_payload)).filter((url): url is string => Boolean(url)))];

  // Live Scout leads answer "can I buy one now?" They deliberately use a
  // server-only read and are never included in verified sales, market value,
  // or price history.
  const admin = getSupabaseAdmin();
  const { data: profileData } = await admin
    .from("marketplace_search_profiles")
    .select("id,last_checked_at,source:sources!inner(name)")
    .eq("edition_id", id)
    .eq("is_active", true)
    .eq("source.name", "eBay Sold");
  const liveProfiles = (profileData ?? []) as unknown as LiveListingProfile[];
  const liveProfileIds = liveProfiles.map((profile) => profile.id);
  const { data: liveLeadData } = liveProfileIds.length
    ? await admin
      .from("scout_listing_leads")
      .select("id,profile_id,source_listing_url,listing_title,listing_price,currency,item_end_at,last_seen_at,raw_payload")
      .in("profile_id", liveProfileIds)
      .in("review_status", ["new", "watching"])
      .gt("item_end_at", new Date().toISOString())
      .order("item_end_at", { ascending: true, nullsFirst: false })
      .limit(24)
    : { data: [] };
  const liveListings = ((liveLeadData ?? []) as LiveListing[])
    .slice(0, 6);
  const latestScoutCheck = liveProfiles
    .map((profile) => profile.last_checked_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  const details = [
    ["Series", edition.series],
    ["Collectible type", readableType(edition.collectible_type)],
    ["Volume", edition.volume_number ? `Vol. ${edition.volume_number}` : null],
    ["Language", edition.language],
    ["Country", edition.country],
    ["Author", edition.author],
    ["Publisher", edition.publisher],
    ["Imprint", edition.imprint],
    ["Format", edition.format],
    ["Release date", formatDate(edition.release_date)],
    ["ISBN-13", edition.isbn_13],
    ["ISBN-10", edition.isbn_10],
    ["Edition", edition.edition_statement],
    ["Printing", edition.printing_number ? `${edition.printing_number}${edition.printing_number === 1 ? "st" : "th"} printing` : null],
  ].filter(([, value]) => value) as Array<[string, string]>;

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/identify">Identify a copy</Link>
          <Link className="header-note" href="/browse">Browse editions</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
        </nav>
      </header>

      <section className="edition-hero">
        <div className="edition-hero-inner edition-hero-with-cover">
          <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="edition-hero-cover" priority />
          <div>
          <Link href="/" className="back-link">← Back to the index</Link>
          <p className="eyebrow">Catalogue edition record</p>
          <h1>{edition.title}</h1>
          <p className="edition-subtitle">
            {[edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {edition.variant_name || edition.edition_statement ? (
            <p className="edition-variant">{edition.variant_name || edition.edition_statement}</p>
          ) : null}
          </div>
        </div>
      </section>

      <MarketCurrencyProvider>
      <section className="edition-content">
        <div className="edition-layout">
          <details className="edition-disclosure catalogue-details-disclosure">
            <summary><span><small>Catalogue record</small>Edition details</span><span className="disclosure-hint">Identifiers, publication and cover source</span></summary>
            <div className="edition-disclosure-content">
            <div className="section-intro">
              <p className="eyebrow">Catalogue record</p>
              <h2>Edition details</h2>
            </div>
            <dl className="edition-details">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="cover-provenance">
              <span>Edition cover</span>
              {edition.cover_verification_status === "verified" ? (
                <p>Catalogue cover sourced from <a href={edition.cover_source_url!} target="_blank" rel="noreferrer">{edition.cover_source_name} ↗</a>. Cover art identifies this catalogue record; sale photos remain linked with their individual sales.</p>
              ) : <p>RAR has not yet verified an exact-edition cover from a publisher or licensed catalogue record.</p>}
            </div>

            {edition.historical_notes ? (
              <div className="record-note">
                <p className="eyebrow">Collector note</p>
                <p>{edition.historical_notes}</p>
              </div>
            ) : null}

            {edition.importance_tags?.length ? (
              <div className="tag-list" aria-label="Edition tags">
                {edition.importance_tags.map((tag: string) => (
                  <span key={tag}>{readableTag(tag)}</span>
                ))}
              </div>
            ) : null}
            </div>
          </details>

          <aside className="valuation-panel">
            <p className="eyebrow">RAR market evidence</p>
            <MarketValuePanel sales={verifiedSales} rates={fxRates} />
            {metrics.length ? (
              <div className="metric-stack">
                {metrics.map((metric) => (
                  <div className="metric-card" key={metric.currency}>
                    <span className="metric-label">Median · {metric.currency}</span>
                    <strong>{formatPrice(metric.market_value_median, metric.currency)}</strong>
                    <dl>
                      <div><dt>Verified sales</dt><dd>{metric.verified_sale_count}</dd></div>
                      <div><dt>Highest</dt><dd>{formatPrice(metric.highest_verified_sale, metric.currency)}</dd></div>
                      <div><dt>Latest sale</dt><dd>{formatDate(metric.latest_sale_date)}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-valuation">
                <strong>Market evidence is being verified.</strong>
                <p>RAR will show a market value only after it has sales proven to match this exact edition.</p>
              </div>
            )}

            <div className="confidence-panel">
              <p className="eyebrow">RAR confidence</p>
              <strong className="confidence-label">{signalLabel(verifiedSales.length, verifiedSourceIds.size)}</strong>
              <div className="confidence-grid">
                <div className="confidence-signal">
                  <span>Verified sales</span>
                  <strong>{verifiedSales.length}</strong>
                </div>
                <div className="confidence-signal">
                  <span>Under review</span>
                  <strong>{pendingSales.length}</strong>
                </div>
                <div className="confidence-signal">
                  <span>Sources observed</span>
                  <strong>{observedSourceNames.length || "—"}</strong>
                  <small>{observedSourceNames.length ? observedSourceNames.join(" · ") : "No completed sale source yet"}</small>
                </div>
                <div className="confidence-signal">
                  <span>Latest verified sale</span>
                  <strong>{latestVerifiedSale ? formatPrice(latestVerifiedSale.sale_price, latestVerifiedSale.currency) : "—"}</strong>
                  <small>{latestVerifiedSale ? formatDate(latestVerifiedSale.sold_date) : "No verified sale yet"}</small>
                </div>
              </div>
              <details className="valuation-explainer">
                <summary>How RAR values this edition</summary>
                <p>RAR uses only completed sales that match this exact edition. Raw and graded results stay separate. You can select a display currency; RAR keeps every original amount and converts it using the European Central Bank reference rate on the sale date. The median is market evidence, not a promise of resale value.</p>
              </details>
            </div>
            <Link className="portfolio-add-button" href={`/portfolio?edition=${edition.id}`}>Add to portfolio — free account →</Link>
          </aside>
        </div>

        <section className="price-history-section">
          <PriceHistoryChart sales={verifiedSales} rates={fxRates} />
        </section>

        <section className="live-listings-section" aria-labelledby="live-listings-heading">
          <div className="section-intro live-listings-intro">
            <div>
              <p className="eyebrow">RAR Scout</p>
              <h2 id="live-listings-heading">Live eBay listings</h2>
            </div>
            <span className="live-listings-status">{latestScoutCheck ? `Last checked ${formatDate(latestScoutCheck)}` : liveProfileIds.length ? "Waiting for first scan" : "Not monitored yet"}</span>
          </div>
          <p className="section-copy">Current listings are buying opportunities, not completed sales. They never affect RAR&apos;s market value, verified-sale count, or chart.</p>
          {liveListings.length ? (
            <div className="live-listings-grid">
              {liveListings.map((listing) => (
                <a className="live-listing-card" href={listing.source_listing_url} target="_blank" rel="noreferrer" key={listing.id}>
                  <div><span>{listingType(listing.raw_payload)} · eBay</span><h3>{listing.listing_title}</h3></div>
                  <div className="live-listing-meta"><strong>{listing.listing_price !== null && listing.currency ? formatPrice(listing.listing_price, listing.currency) : "Price not listed"}</strong><small>Ends {formatListingEnd(listing.item_end_at!)}</small></div>
                </a>
              ))}
            </div>
          ) : (
            <div className="live-listings-empty">
              <strong>{liveProfileIds.length ? "No current listings from RAR Scout" : "Live listings are not being monitored for this edition yet"}</strong>
              <p>{liveProfileIds.length ? "Scout stores only listings that are still live at the time of viewing. Check again after the next scheduled scan." : "RAR needs an exact-edition eBay search profile before it can surface live buying opportunities."}</p>
            </div>
          )}
        </section>

        <details className="edition-disclosure edition-evidence-section" open={edition.printing_number === 1}>
          <summary><span><small>Why this edition is identified</small>Edition evidence</span><span className="disclosure-hint">{edition.printing_number === 1 ? "First-print proof included" : "Identifiers and proof"}</span></summary>
          <div className="edition-disclosure-content">
            <p className="section-copy">RAR separates the publisher&apos;s edition record from proof of a specific printing. A first-print claim requires copyright-page evidence.</p>
          <div className="edition-evidence-grid">
            <div><span>Edition identifiers</span><strong>{edition.isbn_13 ?? edition.isbn_10 ?? "ISBN still needed"}</strong><small>{[edition.publisher, edition.release_date ? formatDate(edition.release_date) : null].filter(Boolean).join(" · ") || "Publisher or release date still needed"}</small></div>
            <div><span>Printing status</span><strong>{edition.printing_number === 1 ? "First printing recorded" : edition.printing_number ? `Printing ${edition.printing_number} recorded` : "Printing not yet proven"}</strong><small>{edition.printing_number === 1 ? "Check the copyright-page proof below." : "Do not infer a printing from the release date alone."}</small></div>
            <div><span>Copyright-page proof</span><strong>{copyrightProofUrls.length ? `${copyrightProofUrls.length} linked reference${copyrightProofUrls.length === 1 ? "" : "s"}` : "No linked reference yet"}</strong><small>{copyrightProofUrls.length ? "Recorded from a specific marketplace listing or physical copy." : "Add a direct proof image when reviewing a sale or edition."}</small></div>
          </div>
          {copyrightProofUrls.length ? <div className="evidence-proof-links">{copyrightProofUrls.map((url, index) => <a href={url} key={url} target="_blank" rel="noreferrer">Open copyright-page proof {index + 1} ↗</a>)}</div> : null}
          <div className="evidence-checklist" aria-label="RAR evidence checklist">
            <p className="eyebrow">RAR evidence checklist</p>
            <div>
              <span className={edition.is_verified ? "checked" : "needed"}>{edition.is_verified ? "✓" : "-"}</span>
              <strong>Edition record</strong>
              <small>{edition.is_verified ? "Catalogue record reviewed" : "Still awaiting catalogue review"}</small>
            </div>
            <div>
              <span className={edition.isbn_13 || edition.isbn_10 ? "checked" : "needed"}>{edition.isbn_13 || edition.isbn_10 ? "✓" : "-"}</span>
              <strong>Identifier</strong>
              <small>{edition.isbn_13 || edition.isbn_10 ? "ISBN recorded" : "ISBN still needed"}</small>
            </div>
            <div>
              <span className={edition.release_date ? "checked" : "needed"}>{edition.release_date ? "✓" : "-"}</span>
              <strong>Publication date</strong>
              <small>{edition.release_date ? "Date recorded" : "Date still needed"}</small>
            </div>
            <div>
              <span className={edition.printing_number && copyrightProofUrls.length ? "checked" : "needed"}>{edition.printing_number && copyrightProofUrls.length ? "✓" : "-"}</span>
              <strong>Printing proof</strong>
              <small>{edition.printing_number && copyrightProofUrls.length ? "Copyright page linked" : "Do not infer from a listing title"}</small>
            </div>
            <div>
              <span className={verifiedSales.length ? "checked" : "needed"}>{verifiedSales.length ? "✓" : "-"}</span>
              <strong>Market evidence</strong>
              <small>{verifiedSales.length ? `${verifiedSales.length} verified sale${verifiedSales.length === 1 ? "" : "s"}` : "No verified sale yet"}</small>
            </div>
          </div>
          </div>
        </details>

        {relatedEditions.length ? (
          <details className="edition-disclosure related-editions-section">
            <summary><span><small>Compare before you buy</small>Other records for this volume</span><span className="disclosure-hint">{relatedEditions.length} record{relatedEditions.length === 1 ? "" : "s"}</span></summary>
            <div className="edition-disclosure-content">
              <p className="section-copy">These are separate RAR catalogue records for the same series and volume. A standard edition is not proof of a specific printing.</p>
            <div className="related-editions-list">
              {relatedEditions.map((related) => (
                <Link href={`/edition/${related.id}`} key={related.id}>
                  <span>{related.language || "Language pending"}</span>
                  <strong>{relatedEditionLabel(related)}</strong>
                  <small>{[related.publisher, related.isbn_13 ? `ISBN ${related.isbn_13}` : null].filter(Boolean).join(" · ")}</small>
                </Link>
              ))}
            </div>
            </div>
          </details>
        ) : null}

        {edition.historical_notes || edition.importance_tags?.length ? (
          <details className="edition-disclosure collector-context-section">
            <summary><span><small>Collector context</small>Why collectors care</span><span className="disclosure-hint">Research notes and tags</span></summary>
            <div className="edition-disclosure-content">
              <p className="section-copy">RAR records why a specific edition may matter, without treating a historical note as a prediction of future value.</p>
            <div className="collector-context-card">
              <div>
                <span>Collectible type</span>
                <strong>{readableType(edition.collectible_type)}</strong>
              </div>
              {edition.importance_tags?.length ? (
                <div>
                  <span>Research tags</span>
                  <p className="collector-context-tags">{edition.importance_tags.map((tag: string) => readableTag(tag)).join(" · ")}</p>
                </div>
              ) : null}
              {edition.historical_notes ? (
                <div>
                  <span>RAR note</span>
                  <p>{edition.historical_notes}</p>
                </div>
              ) : null}
            </div>
            </div>
          </details>
        ) : null}

        <section className="observed-sales-section">
          <div className="section-intro">
            <p className="eyebrow">Recent market evidence</p>
            <h2>Observed completed sales</h2>
            <p className="section-copy">
              These are marketplace listings that completed. RAR uses a sale in market evidence only after the listing is proven to match this exact edition.
            </p>
          </div>
          {observedSales.length ? (
            <div className="observed-sales-list">
              {observedSales.slice(0, 12).map((sale) => {
                const content = (
                  <>
                    <div>
                      <span className="sale-source">{sale.source_id ? sourceNames.get(sale.source_id) ?? "Marketplace sale" : "Marketplace sale"}</span>
                      <strong>{formatPrice(sale.sale_price, sale.currency)}</strong>
                      <small>{formatDate(sale.sold_date)}{sale.grading_company || sale.grade_label ? ` · ${[sale.grading_company, sale.grade_label].filter(Boolean).join(" ")}` : ""}</small>
                    </div>
                    <span className={`sale-status ${sale.match_status}`}>{matchStatusLabel(sale.match_status)}</span>
                  </>
                );

                return sale.source_listing_url ? (
                  <a className="observed-sale" href={sale.source_listing_url} target="_blank" rel="noreferrer" key={sale.source_listing_url}>
                    {content}
                  </a>
                ) : (
                  <div className="observed-sale" key={`${sale.sold_date}-${sale.sale_price}`}>
                    {content}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="status-message">No completed sales have been recorded for this edition yet.</p>
          )}
        </section>

        <CommunityReportForm editionId={edition.id} editionTitle={edition.title} />

        <details className="edition-disclosure sources-section">
          <summary><span><small>Provenance</small>Catalogue sources</span><span className="disclosure-hint">{sourceLinks.length} linked source{sourceLinks.length === 1 ? "" : "s"}</span></summary>
          <div className="edition-disclosure-content">
          {sourceLinks.length ? (
            <div className="source-list">
              {sourceLinks.map((source) => (
                <a className="source-card" href={source.source_record_url} target="_blank" rel="noreferrer" key={source.source_record_url}>
                  <span>{sourceNames.get(source.source_id) ?? "Catalogue source"}</span>
                  <strong>View original record ↗</strong>
                  {source.verification_notes ? <small>{source.verification_notes}</small> : null}
                </a>
              ))}
            </div>
          ) : (
            <p className="status-message">Source evidence will be attached as this edition is verified.</p>
          )}
          </div>
        </details>
      </section>
      </MarketCurrencyProvider>
    </main>
  );
}
