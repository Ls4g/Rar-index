import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import PublicationPrintTabs, { type PublicationSale } from "@/components/PublicationPrintTabs";
import CommunityReportForm from "@/components/CommunityReportForm";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import EditionCover from "@/components/EditionCover";
import ThemeToggle from "@/components/ThemeToggle";
import type { FxRate } from "@/lib/fx";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { formatListingEndLabel, isPlausibleLiveListing, listingType } from "@/lib/liveListings";
import { editionDescriptor } from "@/lib/editionDisplay";

// Valuations are live market intelligence, not deployment-time content.
export const dynamic = "force-dynamic";

type EditionPageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ printing?: string }>;
};

type SourceLink = {
  source_id: string;
  source_record_url: string;
  verification_notes: string | null;
  fields_verified: string[] | null;
};

type Source = { id: string; name: string };

type ObservedSaleRow = {
  id: string;
  edition_id: string;
  source_id: string | null;
  source_listing_url: string | null;
  listing_title: string | null;
  sold_date: string | null;
  sale_price: number;
  currency: string;
  grading_company: string | null;
  grade_label: string | null;
  match_status: "verified_match" | "needs_review" | "excluded";
  print_classification: "first_print_proven" | "known_later_print" | "printing_not_identified";
  printing_proof_url: string | null;
  known_printing_number: number | null;
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

type PrintRunChild = {
  id: string;
  title: string | null;
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
  review_status: "new" | "watching" | "dismissed";
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
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function signalLabel(verifiedSales: number, verifiedSources: number) {
  if (verifiedSales >= 6 && verifiedSources >= 3) return "Established evidence";
  if (verifiedSales >= 3 && verifiedSources >= 2) return "Developing evidence";
  return "Early evidence";
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

// A print-run record that redirects here (see below) is either a proven
// first print or a proven later printing -- decide which tab to land on
// from its own identity, best-effort, so a shared/bookmarked link still
// opens on the group its title actually claims.
function looksLikeFirstPrint(printingNumber: number | null, text: string | null) {
  if (printingNumber === 1) return true;
  if (printingNumber && printingNumber > 1) return false;
  return /first/i.test(text ?? "");
}

export default async function EditionPage({ params, searchParams }: EditionPageProps) {
  const { id } = await params;
  const search = await searchParams;

  // A print-run record is never the public destination -- it always
  // redirects to its publication, with the correct print group selected,
  // so every historical /edition/{printRunId} link keeps working.
  const { data: recordCheck } = await supabase
    .from("manga_editions")
    .select("id, printing_of_edition_id, printing_number, edition_statement, variant_name")
    .eq("id", id)
    .maybeSingle();

  if (!recordCheck) notFound();

  if (recordCheck.printing_of_edition_id) {
    const tab = looksLikeFirstPrint(recordCheck.printing_number, recordCheck.edition_statement || recordCheck.variant_name) ? "first" : "other";
    redirect(`/edition/${recordCheck.printing_of_edition_id}?printing=${tab}`);
  }

  const { data: edition } = await supabase
    .from("manga_editions")
    .select(
      "id, title, series, volume_number, author, publisher, imprint, language, country, isbn_10, isbn_13, release_date, format, edition_statement, printing_number, variant_name, historical_notes, importance_tags, is_verified, collectible_type, cover_image_url, cover_source_url, cover_source_name, cover_verification_status, printing_of_edition_id"
    )
    .eq("id", id)
    .maybeSingle();

  if (!edition) notFound();

  const { data: printRunChildrenData } = await supabase
    .from("manga_editions")
    .select("id,title,edition_statement,printing_number,variant_name")
    .eq("printing_of_edition_id", id)
    .eq("is_verified", true);
  const printRunChildren = (printRunChildrenData ?? []) as PrintRunChild[];
  const familyIds = [id, ...printRunChildren.map((child) => child.id)];

  const relatedEditionsResult = edition.series && edition.volume_number
    ? await supabase
      .from("manga_editions")
      .select("id,title,language,publisher,isbn_13,edition_statement,printing_number,variant_name")
      .eq("series", edition.series)
      .eq("volume_number", edition.volume_number)
      .eq("is_verified", true)
      .not("id", "in", `(${familyIds.join(",")})`)
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
      .select("id, edition_id, source_id, source_listing_url, listing_title, sold_date, sale_price, currency, grading_company, grade_label, match_status, print_classification, printing_proof_url, known_printing_number")
      .in("edition_id", familyIds)
      .eq("sale_status", "confirmed")
      .neq("match_status", "excluded")
      .order("sold_date", { ascending: false })
      .limit(200),
  ]);

  const sourceLinks = (sourceLinksResult.data ?? []) as SourceLink[];
  const observedSales = (observedSalesResult.data ?? []) as ObservedSaleRow[];
  const firstPrintSales: PublicationSale[] = observedSales
    .filter((sale) => sale.print_classification === "first_print_proven")
    .map((sale) => ({ ...sale, match_status: sale.match_status as "verified_match" | "needs_review" }));
  const otherSales: PublicationSale[] = observedSales
    .filter((sale) => sale.print_classification !== "first_print_proven")
    .map((sale) => ({ ...sale, match_status: sale.match_status as "verified_match" | "needs_review" }));
  const verifiedSales = observedSales.filter((sale) => sale.match_status === "verified_match");
  const pendingSales = observedSales.filter((sale) => sale.match_status === "needs_review");
  const firstPrintVerifiedCount = firstPrintSales.filter((sale) => sale.match_status === "verified_match").length;

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
      ...observedSales.map((sale) => sale.source_id).filter((sourceId): sourceId is string => Boolean(sourceId)),
    ]),
  ];
  const sourcesResult = sourceIds.length
    ? await supabase.from("sources").select("id, name").in("id", sourceIds)
    : { data: [] as Source[] };
  const sourceNames = new Map((sourcesResult.data ?? []).map((source) => [source.id, source.name]));
  const sourceNamesObject = Object.fromEntries(sourceNames);
  const observedSourceNames = [...new Set([...observedSourceIds].map((sourceId) => sourceNames.get(sourceId) ?? "Marketplace").filter(Boolean))];
  const relatedEditions = (relatedEditionsResult.data ?? []) as RelatedEdition[];

  // Live Scout leads answer "can I buy one now?" They deliberately use a
  // server-only read and are never included in verified sales, market value,
  // or price history. Shown at the publication level -- across every
  // print-run record in the family -- unless a listing's own print claim is
  // separately proven (Scout never proves that; it only ever produces leads).
  const admin = getSupabaseAdmin();
  const { data: profileData } = await admin
    .from("marketplace_search_profiles")
    .select("id,last_checked_at,source:sources!inner(name)")
    .in("edition_id", familyIds)
    .eq("is_active", true)
    .eq("source.name", "eBay Sold");
  const liveProfiles = (profileData ?? []) as unknown as LiveListingProfile[];
  const liveProfileIds = liveProfiles.map((profile) => profile.id);
  const liveListingNowDate = new Date();
  const liveListingNow = liveListingNowDate.toISOString();
  const liveListingFreshnessCutoff = new Date(liveListingNowDate.getTime() - 48 * 60 * 60 * 1000).toISOString();
  const { data: liveLeadData } = liveProfileIds.length
    ? await admin
      .from("scout_listing_leads")
      .select("id,profile_id,review_status,source_listing_url,listing_title,listing_price,currency,item_end_at,last_seen_at,raw_payload")
      .in("profile_id", liveProfileIds)
      .in("review_status", ["new", "watching"])
      .gte("last_seen_at", liveListingFreshnessCutoff)
      .or("item_end_at.gt." + liveListingNow + ",item_end_at.is.null")
      .order("item_end_at", { ascending: true, nullsFirst: false })
      .limit(50)
    : { data: [] };
  const liveListings = ((liveLeadData ?? []) as LiveListing[])
    // A staff member marking a listing as Watching is an explicit human
    // confirmation that it belongs on this exact publication's live feed.
    // New leads still need the conservative automatic plausibility check.
    .filter((listing) => listing.review_status === "watching" || isPlausibleLiveListing(listing, edition))
    .slice(0, 6);
  const latestScoutCheck = liveProfiles
    .map((profile) => profile.last_checked_at)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;

  const initialTab: "first" | "other" = search.printing === "other" ? "other" : search.printing === "first" ? "first" : firstPrintSales.length ? "first" : "other";

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
  ].filter(([, value]) => value) as Array<[string, string]>;

  return (
    <main className="public-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/identify">First-print check</Link>
          <Link className="header-note" href="/browse">Browse manga</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
          <Link className="header-note" href="/staff-login">Staff access</Link>
          <ThemeToggle />
        </nav>
      </header>

      <section className="edition-hero">
        <div className="edition-hero-inner edition-hero-with-cover">
          <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="edition-hero-cover" priority />
          <div>
          <Link href="/" className="back-link">← Back to the index</Link>
          <p className="eyebrow">Manga</p>
          <h1>{edition.title}</h1>
          <p className="edition-subtitle">
            {[edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {/* Telling a reader to "select a printing group below" is only
              useful when groups with sales exist. On a record RAR has no
              completed sales for, that was an instruction they could not
              follow. */}
          <p className="edition-variant">
            {firstPrintSales.length || otherSales.length
              ? <>Pick a printing below to see what those copies sold for.{printRunChildren.length ? ` ${printRunChildren.length} specific printing${printRunChildren.length === 1 ? " has its own record" : "s have their own records"} feeding into this page.` : ""}</>
              : "No completed sale has been confirmed for this one yet."}
          </p>
          </div>
        </div>
      </section>

      <MarketCurrencyProvider>
      <section className="edition-content">
        <div className="edition-layout">
          <details className="edition-disclosure catalogue-details-disclosure">
            <summary><span><small>The specifics</small>Book details</span><span className="disclosure-hint">Identifiers, publisher and cover source</span></summary>
            <div className="edition-disclosure-content">
            <div className="section-intro">
              <p className="eyebrow">The specifics</p>
              <h2>Book details</h2>
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
              <span>Publication cover</span>
              {edition.cover_verification_status === "verified" ? (
                <p>Catalogue cover sourced from <a href={edition.cover_source_url!} target="_blank" rel="noreferrer">{edition.cover_source_name} ↗</a>. Cover art identifies this publication; sale photos remain linked with their individual sales.</p>
              ) : edition.cover_verification_status === "candidate" ? (
                <p>A candidate cover has been found for this publication but is not yet confirmed against a publisher or licensed catalogue record.</p>
              ) : edition.cover_verification_status === "rejected" ? (
                <p>A candidate cover was reviewed and did not match this exact publication. RAR is still looking for a confirmed cover source.</p>
              ) : <p>RAR has not yet sourced a cover for this publication from a publisher or licensed catalogue record.</p>}
              <Link className="staff-action-link" href={`/cover-review?edition=${edition.id}`}>Review this cover -&gt;</Link>
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
            <p className="eyebrow">How much we know</p>
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
              <summary>How we work out this value</summary>
              <p>Only completed sales of this exact book count. Proven first prints, known later printings and copies whose printing we could not identify are never mixed into one number, and graded copies stay separate from raw ones. Prices are stored in the currency they sold in and converted using the European Central Bank rate for that day. A median tells you what copies have sold for — not what yours will sell for.</p>
            </details>
            <div className="valuation-panel-live-teaser">
              <span><strong>{liveListings.length}</strong> live listing{liveListings.length === 1 ? "" : "s"} right now</span>
              <a href="#live-listings-heading">Can I buy one? →</a>
            </div>
            <Link className="portfolio-add-button" href={`/portfolio?edition=${edition.id}`}>Add to portfolio — free account →</Link>
          </aside>
        </div>

        <section className="price-history-section">
          <div className="section-intro">
            <p className="eyebrow">What copies actually sell for</p>
            <h2>Sold prices, by printing</h2>
          </div>
          <PublicationPrintTabs firstPrintSales={firstPrintSales} otherSales={otherSales} rates={fxRates} sourceNames={sourceNamesObject} initialTab={initialTab} editionId={edition.id} series={edition.series} />
        </section>

        <section className="live-listings-section" aria-labelledby="live-listings-heading">
          <div className="section-intro live-listings-intro">
            <div>
              <p className="eyebrow">RAR Scout</p>
              <h2 id="live-listings-heading">Can I buy one right now?</h2>
            </div>
            <span className="live-listings-status">{latestScoutCheck ? `Last Scout scan ${formatDate(latestScoutCheck)}` : liveProfileIds.length ? "Waiting for first scan" : "Not monitored yet"}</span>
          </div>
          <p className="section-copy">These are asking prices on eBay right now, not sold prices, covering every printing of this manga. We only show listings whose title clearly matches this series and volume — always check the listing yourself before buying. Nothing here affects the value or the chart above.</p>
          {liveListings.length ? (
            <div className="live-listings-grid">
              {liveListings.map((listing) => (
                <a className="live-listing-card" href={listing.source_listing_url} target="_blank" rel="noreferrer" key={listing.id}>
                  <div><span>{listingType(listing.raw_payload)} · eBay</span><h3>{listing.listing_title}</h3></div>
                  <div className="live-listing-meta"><strong>{listing.listing_price !== null && listing.currency ? formatPrice(listing.listing_price, listing.currency) : "Price not listed"}</strong>{formatListingEndLabel(listing.item_end_at) ? <small>{formatListingEndLabel(listing.item_end_at)}</small> : null}</div>
                </a>
              ))}
            </div>
          ) : (
            <div className="live-listings-empty">
              <strong>{liveProfileIds.length ? "Nothing on sale right now" : "We are not watching eBay for this one yet"}</strong>
              <p>{liveProfileIds.length ? "We only show listings that are still live when you look. Check back after the next scan." : "This manga needs an exact-edition eBay search set up before listings can appear here."}</p>
            </div>
          )}
        </section>

        <details className="edition-disclosure edition-evidence-section" open={firstPrintVerifiedCount > 0}>
          <summary><span><small>How we know this is what we say it is</small>The proof behind this page</span><span className="disclosure-hint">{firstPrintVerifiedCount > 0 ? "First-print proof on file" : "Identifiers and proof"}</span></summary>
          <div className="edition-disclosure-content">
            <p className="section-copy">Knowing which book this is and proving a specific copy was a first printing are two different things. The second needs a photo of the copyright page from the exact copy that sold — a famous title is not proof, and neither is a seller saying so.</p>
          <div className="edition-evidence-grid">
            <div><span>Which book this is</span><strong>{edition.isbn_13 ?? edition.isbn_10 ?? "ISBN still needed"}</strong><small>{[edition.publisher, edition.release_date ? formatDate(edition.release_date) : null].filter(Boolean).join(" · ") || "Publisher or release date still needed"}</small></div>
            <div><span>First-print proof</span><strong>{firstPrintVerifiedCount > 0 ? `${firstPrintVerifiedCount} proven sale${firstPrintVerifiedCount === 1 ? "" : "s"}` : "Not yet proven"}</strong><small>{firstPrintVerifiedCount > 0 ? "See the First-print sales tab above." : "No sale has a copyright-page photo yet."}</small></div>
            <div><span>Other sales on file</span><strong>{otherSales.length} sale{otherSales.length === 1 ? "" : "s"}</strong><small>Later printings, and copies whose printing we could not identify — see the Other tab above.</small></div>
          </div>
          <div className="evidence-checklist" aria-label="RAR evidence checklist">
            <p className="eyebrow">RAR evidence checklist</p>
            <div>
              <span className={edition.is_verified ? "checked" : "needed"}>{edition.is_verified ? "✓" : "-"}</span>
              <strong>Publication record</strong>
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
              <span className={firstPrintVerifiedCount > 0 ? "checked" : "needed"}>{firstPrintVerifiedCount > 0 ? "✓" : "-"}</span>
              <strong>Printing proof</strong>
              <small>{firstPrintVerifiedCount > 0 ? "Copyright page linked to a specific sale" : "No sale has been proven a first print yet"}</small>
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
            <summary><span><small>Different language or publisher</small>Related publications</span><span className="disclosure-hint">{relatedEditions.length} publication{relatedEditions.length === 1 ? "" : "s"}</span></summary>
            <div className="edition-disclosure-content">
              <p className="section-copy">Same series and volume, but a different book — another language or another publisher, not another printing of this one. Printings of this exact book are compared in the tabs above.</p>
            <div className="related-editions-list">
              {relatedEditions.map((related) => (
                <Link href={`/edition/${related.id}`} key={related.id}>
                  <span>{related.language || "Language pending"}</span>
                  <strong>{editionDescriptor(related)}</strong>
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
              <p className="section-copy">Why this particular book is worth knowing about. A note about its history is not a prediction about its price.</p>
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
            <p className="status-message">Source evidence will be attached as this publication is verified.</p>
          )}
          </div>
        </details>
      </section>
      </MarketCurrencyProvider>
    </main>
  );
}
