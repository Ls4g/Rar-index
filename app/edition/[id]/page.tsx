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
import { describeSaleFrequency } from "@/lib/saleFrequency";
import { describeAvailability, AVAILABILITY_CAVEAT } from "@/lib/availability";
import { editionDescriptor, publisherDisplayName } from "@/lib/editionDisplay";

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
  source_data: {
    derived_first_appearances?: string[];
    catalogue_series_matched?: string[];
    madb?: {
      pages?: number | null;
      cover_price_yen?: number | null;
    };
  } | null;
};

type Source = { id: string; name: string };

type SeriesProfile = {
  display_name: string;
  tagline: string | null;
  synopsis: string;
  source_name: string;
  source_url: string;
};

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

// The source writes "DRAGON　BALL" with a full-width space, so a title can
// differ from its own English name by whitespace alone and get printed twice.
function tidySpacing(value: string | null | undefined) {
  return String(value ?? "").replace(/[　\s]+/g, " ").trim();
}

function readableType(value: string | null) {
  if (!value || value === "tankobon") return "Tankōbon / volume";
  if (value === "zasshi") return "Magazine issue / zasshi";
  return value.replaceAll("_", " ");
}

function readableTag(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function seriesProfileKey(value: string | null) {
  return (value ?? "")
    .normalize("NFKD")
    .replaceAll("×", "x")
    .replace(/\s+volume\s+\d+$/i, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
      "id, title, series, volume_number, author, publisher, imprint, language, country, isbn_10, isbn_13, release_date, format, edition_statement, printing_number, variant_name, historical_notes, importance_tags, is_verified, collectible_type, cover_image_url, cover_source_url, cover_source_name, cover_verification_status, printing_of_edition_id, magazine_title_id, issue_year, issue_number_label, cumulative_issue_no, madb_id"
    )
    .eq("id", id)
    .maybeSingle();

  if (!edition) notFound();
  const isMagazine = edition.collectible_type === "zasshi";

  const profileKey = seriesProfileKey(edition.series || edition.title);
  const { data: seriesProfileData } = profileKey
    ? await supabase
      .from("series_profiles")
      .select("display_name,tagline,synopsis,source_name,source_url")
      .eq("series_key", profileKey)
      .eq("is_verified", true)
      .maybeSingle()
    : { data: null };
  const seriesProfile = seriesProfileData as SeriesProfile | null;

  const { data: printRunChildrenData } = await supabase
    .from("manga_editions")
    .select("id,title,edition_statement,printing_number,variant_name")
    .eq("printing_of_edition_id", id)
    .eq("is_verified", true);
  const printRunChildren = (printRunChildrenData ?? []) as PrintRunChild[];
  const familyIds = [id, ...printRunChildren.map((child) => child.id)];

  // Sibling volumes in the same series and language. Manga is a
  // series-and-volume medium and the page offered no way to move along it,
  // which is the most natural thing a collector wants to do. Matched on
  // language too, so an English Vol. 2 is never offered as the next volume
  // of a Japanese Vol. 1 -- those are different books, not neighbours.
  const siblingVolumesResult = edition.series && !isMagazine
    ? await supabase
      .from("manga_editions")
      .select("id,volume_number,language")
      .eq("series", edition.series)
      .eq("language", edition.language)
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .not("volume_number", "is", null)
      .limit(400)
    : { data: [] as Array<{ id: string; volume_number: string | null; language: string | null }> };

  const relatedEditionsResult = edition.series && edition.volume_number && !isMagazine
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
      .select("source_id, source_record_url, verification_notes, fields_verified, source_data")
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
  const magazineSource = isMagazine ? sourceLinks.find((source) => source.source_data) : null;
  const firstAppearances = [...new Set(magazineSource?.source_data?.derived_first_appearances?.filter(Boolean) ?? [])];
  const recognisedSeries = [...new Set(magazineSource?.source_data?.catalogue_series_matched?.filter(Boolean) ?? [])];
  // What the issue actually contained, imported from the Media Arts Database
  // by scripts/import-magazine-contents.mjs. A magazine's whole claim on a
  // collector is its table of contents: the 1984 issue that matters is the one
  // carrying chapter 1 of Dragon Ball, and nothing else about the record says
  // so. Catalogue facts only -- these never touch a price.
  const { data: issueContentsData } = isMagazine
    ? await supabase
      .from("magazine_issue_contents")
      .select("work_title, work_title_en, creator, content_kind, is_first_appearance, colour_note, page_start")
      .eq("edition_id", edition.id)
      .order("display_order", { ascending: true })
    : { data: null };
  const issueContents = (issueContentsData ?? []) as Array<{
    work_title: string;
    work_title_en: string | null;
    creator: string | null;
    content_kind: "story" | "cover" | "feature";
    is_first_appearance: boolean;
    colour_note: string | null;
    page_start: number | null;
  }>;
  // The cover feature is the same work as its lead chapter, so listing both
  // would print the headline series twice. The chapter carries the credit.
  const issueStories = issueContents.filter((entry) => entry.content_kind === "story");
  const issueCoverEntry = issueContents.find((entry) => entry.content_kind === "cover") ?? null;
  const issueCoverWork = issueCoverEntry?.work_title ?? null;
  const issueCoverWorkLabel = issueCoverEntry?.work_title_en ?? issueCoverEntry?.work_title ?? null;
  const issueFeatureCount = issueContents.filter((entry) => entry.content_kind === "feature").length;

  const magazinePages = magazineSource?.source_data?.madb?.pages ?? null;
  const originalCoverPriceYen = magazineSource?.source_data?.madb?.cover_price_yen ?? null;
  const observedSales = (observedSalesResult.data ?? []) as ObservedSaleRow[];
  const firstPrintSales: PublicationSale[] = observedSales
    .filter((sale) => sale.print_classification === "first_print_proven")
    .map((sale) => ({ ...sale, match_status: sale.match_status as "verified_match" | "needs_review" }));
  const otherSales: PublicationSale[] = observedSales
    .filter((sale) => sale.print_classification !== "first_print_proven")
    .map((sale) => ({ ...sale, match_status: sale.match_status as "verified_match" | "needs_review" }));
  const verifiedSales = observedSales.filter((sale) => sale.match_status === "verified_match");
  const saleFrequency = describeSaleFrequency(verifiedSales.map((sale) => sale.sold_date));
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

  // Volume numbers are free text ("1", "01", "Vol. 3"), so sort on the first
  // number found and drop anything with none rather than guessing an order.
  const volumeOf = (value: string | null) => {
    const match = String(value ?? "").match(/\d+(\.\d+)?/);
    return match ? Number(match[0]) : null;
  };
  const siblingVolumes = ((siblingVolumesResult.data ?? []) as Array<{ id: string; volume_number: string | null }>)
    .flatMap((row) => {
      const number = volumeOf(row.volume_number);
      return number === null ? [] : [{ id: row.id, number, label: row.volume_number as string }];
    })
    .sort((left, right) => left.number - right.number);
  const distinctVolumeCount = new Set(siblingVolumes.map((entry) => entry.number)).size;
  const currentVolume = volumeOf(edition.volume_number);
  const previousVolume = currentVolume === null ? null : [...siblingVolumes].reverse().find((entry) => entry.number < currentVolume) ?? null;
  const nextVolume = currentVolume === null ? null : siblingVolumes.find((entry) => entry.number > currentVolume) ?? null;

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

  // "Can I still buy this?" answered from RAR's own observation record rather
  // than from a publisher feed it does not have. Rolled up across the whole
  // publication family, because a proven first-printing child being on sale
  // still means a copy of this book is available.
  const { data: availabilityData } = familyIds.length
    ? await admin
      .from("publication_availability")
      .select("edition_id,active_profiles,completed_scans,last_scan_at,leads_ever_seen,last_lead_seen_at,live_now")
      .in("edition_id", familyIds)
    : { data: [] };
  const availabilityRows = (availabilityData ?? []) as Array<{
    active_profiles: number; completed_scans: number; last_scan_at: string | null;
    leads_ever_seen: number; last_lead_seen_at: string | null; live_now: number;
  }>;
  const latestOf = (values: Array<string | null>) => values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const availability = describeAvailability({
    activeProfiles: availabilityRows.reduce((total, row) => total + Number(row.active_profiles ?? 0), 0),
    completedScans: availabilityRows.reduce((total, row) => total + Number(row.completed_scans ?? 0), 0),
    lastScanAt: latestOf(availabilityRows.map((row) => row.last_scan_at)),
    leadsEverSeen: availabilityRows.reduce((total, row) => total + Number(row.leads_ever_seen ?? 0), 0),
    lastLeadSeenAt: latestOf(availabilityRows.map((row) => row.last_lead_seen_at)),
    // The plausibility filter above is stricter than the view's freshness
    // rule, so the count actually shown to a reader is the one used here.
    liveNow: liveListings.length,
  });

  const initialTab: "first" | "other" = search.printing === "other" ? "other" : search.printing === "first" ? "first" : firstPrintSales.length ? "first" : "other";

  const issueLabel = isMagazine
    ? [edition.issue_year, edition.issue_number_label ? `Issue ${edition.issue_number_label}` : null].filter(Boolean).join(" · ")
    : null;
  const displayTitle = isMagazine ? edition.series || edition.title : edition.title;
  const originalTitle = isMagazine && edition.series && edition.title !== edition.series ? edition.title : null;
  const magazineSubjects = recognisedSeries.length ? recognisedSeries : firstAppearances;
  const magazineSubjectLabel = magazineSubjects.join(" · ");
  const readerTagline = isMagazine && magazineSubjects.length
    ? `The issue containing the first serial appearance of ${magazineSubjectLabel}.`
    : seriesProfile?.tagline ?? null;
  const readerSynopsis = isMagazine && magazineSubjects.length
    ? `${displayTitle} ${issueLabel || "this issue"} is collected because it contains ${magazineSubjectLabel}'s magazine debut. It marks the beginning of the series in weekly serial form.`
    : seriesProfile?.synopsis ?? null;
  const editionIntro = isMagazine
    ? [edition.publisher, edition.release_date ? formatDate(edition.release_date) : null].filter(Boolean).join(" · ")
    : [edition.language, edition.format, edition.volume_number ? `Volume ${edition.volume_number}` : null, publisherDisplayName(edition.publisher)].filter(Boolean).join(" · ");
  const profileSourceIsSeparate = Boolean(seriesProfile?.source_url && !sourceLinks.some((source) => source.source_record_url === seriesProfile.source_url));
  const catalogueSourceCount = sourceLinks.length + Number(profileSourceIsSeparate);
  const details = (isMagazine ? [
    ["Magazine", edition.series],
    ["Japanese title", edition.title],
    ["Collectible type", "Magazine issue / zasshi"],
    ["Issue", issueLabel],
    ["Cumulative issue", edition.cumulative_issue_no ? `No. ${edition.cumulative_issue_no}` : null],
    ["Language", edition.language],
    ["Publisher", edition.publisher],
    ["Release date", formatDate(edition.release_date)],
    ["Pages", magazinePages ? String(magazinePages) : null],
    ["Original cover price", originalCoverPriceYen ? `¥${originalCoverPriceYen}` : null],
    ["Media Arts Database ID", edition.madb_id],
  ] : [
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
  ]).filter(([, value]) => value) as Array<[string, string]>;

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
          <Link className="header-note" href="/browse">Browse catalogue</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
          <Link className="header-note" href="/staff-login">Staff access</Link>
          <ThemeToggle />
        </nav>
      </header>

      {/* The book is the page. The cover sits large and undecorated, and its
          own artwork — blurred — is the banner, so every edition looks
          different because the art drives it rather than a fixed gradient.
          Only a real verified cover is used as the ground; a placeholder
          would just be a grey smear. */}
      <section className={`edition-hero edition-stage${edition.cover_image_url && edition.cover_verification_status === "verified" ? " has-art" : ""}`}>
        {edition.cover_image_url && edition.cover_verification_status === "verified" ? (
          <div aria-hidden="true" className="edition-stage-art" style={{ backgroundImage: `url(${JSON.stringify(edition.cover_image_url)})` }} />
        ) : null}
        <div aria-hidden="true" className="edition-stage-veil" />
        <div className="edition-hero-inner edition-stage-inner">
          <div className="edition-stage-book">
            <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} descriptor={isMagazine ? issueLabel : null} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="edition-hero-cover" priority />
          </div>
          <div className="edition-stage-copy">
            <Link href="/" className="back-link">← Back to the index</Link>
            {originalTitle || edition.imprint ? <p className="edition-imprint">{originalTitle || edition.imprint}</p> : null}
            <h1>{displayTitle}</h1>
            <p className="edition-subtitle">
              {(isMagazine
                ? [issueLabel, edition.language]
                : [edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language])
                .filter(Boolean)
                .join(" · ")}
            </p>
            <p className="edition-byline">
              {[edition.author, publisherDisplayName(edition.publisher), edition.release_date ? formatDate(edition.release_date) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {readerSynopsis ? (
              <div className="edition-reader-intro" aria-label="About this publication">
                {readerTagline ? <p className="edition-reader-tagline">{readerTagline}</p> : null}
                <p className="edition-reader-synopsis">{readerSynopsis}</p>
                {editionIntro ? <p className="edition-reader-edition">{editionIntro}</p> : null}
              </div>
            ) : null}
            {previousVolume || nextVolume ? (
              <nav aria-label="Volume navigation" className="volume-nav">
                {previousVolume
                  ? <Link href={`/edition/${previousVolume.id}`}>‹ Vol. {previousVolume.label}</Link>
                  : <span className="is-off">‹ First volume tracked</span>}
                {/* Distinct volume numbers, not records. A series can hold
                    two legitimate editions of the same volume -- One Piece
                    Vol. 1 exists as both a single volume and an omnibus, on
                    different ISBNs -- and counting records would advertise
                    eleven volumes of a ten-volume run. */}
                <Link className="is-index" href={`/browse?q=${encodeURIComponent(edition.series ?? "")}`}>
                  All {distinctVolumeCount} volume{distinctVolumeCount === 1 ? "" : "s"}
                </Link>
                {nextVolume
                  ? <Link href={`/edition/${nextVolume.id}`}>Vol. {nextVolume.label} ›</Link>
                  : <span className="is-off">Latest tracked ›</span>}
              </nav>
            ) : null}
          </div>
        </div>
      </section>

      <MarketCurrencyProvider>
      <section className="edition-content">
        <div className="edition-layout">
          {/* Identity is the product, so it is open and first rather than
              folded behind a disclosure. Grouped by space with two rules,
              not fenced by a hairline under every row. */}
          <section className="edition-facts-section">
            <h2>{isMagazine ? "This issue" : "This book"}</h2>
            <dl className="edition-facts">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd className={label.startsWith("ISBN") ? "is-identifier" : undefined}>{value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <details className="edition-disclosure catalogue-details-disclosure">
            <summary><span><small>Provenance</small>Cover source</span><span className="disclosure-hint">Where the cover art came from, and collector notes</span></summary>
            <div className="edition-disclosure-content">
            <div className="cover-provenance">
              <span>{isMagazine ? "Magazine cover" : "Publication cover"}</span>
              {edition.cover_verification_status === "verified" ? (
                <p>Cover art from <a href={edition.cover_source_url!} target="_blank" rel="noreferrer">{edition.cover_source_name} ↗</a> — confirmed for this exact {isMagazine ? "issue" : "book"}, never borrowed from an unrelated listing. Photos of individual copies stay attached to the records they came from.</p>
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
                {/* How often one actually turns up. A price with no sense of
                    frequency invites a collector to treat a once-a-decade
                    book and a weekly one as equally liquid. */}
                {saleFrequency ? <small>Sells {saleFrequency.label}</small> : null}
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
              <p>{isMagazine
                ? "Only completed sales of this exact magazine issue count. Different years and issue numbers are never mixed together, and graded copies stay separate from raw ones. Prices are stored in the currency they sold in and converted using the European Central Bank rate for that day. A median tells you what copies have sold for — not what yours will sell for."
                : "Only completed sales of this exact book count. Proven first prints, known later printings and copies whose printing we could not identify are never mixed into one number, and graded copies stay separate from raw ones. Prices are stored in the currency they sold in and converted using the European Central Bank rate for that day. A median tells you what copies have sold for — not what yours will sell for."}</p>
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
            <h2>{isMagazine ? "Verified sales for this issue" : "Sold prices, by printing"}</h2>
          </div>
          <PublicationPrintTabs firstPrintSales={firstPrintSales} otherSales={otherSales} rates={fxRates} sourceNames={sourceNamesObject} initialTab={initialTab} editionId={edition.id} series={edition.series} mode={isMagazine ? "exact_issue" : "publication_prints"} />
        </section>

        {isMagazine && (firstAppearances.length || recognisedSeries.length) ? (
          <section className="magazine-contents-section" aria-labelledby="magazine-contents-heading">
            <div className="section-intro">
              <p className="eyebrow">Inside this issue</p>
              <h2 id="magazine-contents-heading">Why collectors know it</h2>
            </div>
            <div className="magazine-contents-card">
              <span>First serial appearance identified</span>
              <strong>{magazineSubjectLabel}</strong>
              <p>This is the Weekly Shonen Jump issue where {magazineSubjectLabel} first appeared in serial form. That debut makes the original issue a distinct historical collectible, separate from later collected volumes and reprints.</p>
            </div>
            {/* The line-up is the argument. A debut sentence says this issue
                matters; the contents show what a reader in December 1984
                actually held, which is what a collector is buying. */}
            {issueStories.length ? (
              /* Folded away by default. Fifteen chapters is the argument for
                 the issue, not the first thing to read: the debut card above
                 says why it matters, and this is there for anyone who wants
                 the detail. A native disclosure needs no client JS and works
                 before hydration. */
              <details className="issue-lineup">
                <summary>
                  See the full line-up
                  <span>{issueStories.length} chapters{issueCoverWork ? ` · cover: ${issueCoverWorkLabel}` : ""}</span>
                </summary>
                <p className="issue-lineup-intro">
                  Everything serialised in this issue, in the order it was printed
                  {issueFeatureCount ? <> · {issueFeatureCount} other {issueFeatureCount === 1 ? "page" : "pages"} not listed</> : null}
                </p>
                <ol className="issue-lineup-list">
                  {issueStories.map((entry) => (
                    <li className={entry.is_first_appearance ? "is-debut" : undefined} key={`${entry.work_title}-${entry.page_start ?? "x"}`}>
                      {/* Romanised where one is known, the Japanese title kept
                          underneath. Both are useful: the reader recognises one
                          and every seller writes the other. Where no
                          romanisation was found the Japanese title stands
                          alone rather than being guessed at. */}
                      <span className="issue-lineup-work">{tidySpacing(entry.work_title_en ?? entry.work_title)}</span>
                      <span className="issue-lineup-creator">
                        {entry.work_title_en && tidySpacing(entry.work_title_en) !== tidySpacing(entry.work_title) ? <span className="issue-lineup-original">{tidySpacing(entry.work_title)}</span> : null}
                        {entry.creator}
                      </span>
                      {entry.is_first_appearance ? <span className="issue-lineup-debut">First appearance</span> : null}
                    </li>
                  ))}
                </ol>
                <p className="issue-lineup-note">
                  Contents as recorded by the Media Arts Database. Catalogue facts describing the issue — never a price or an estimate of one.
                </p>
              </details>
            ) : null}
          </section>
        ) : null}

        <section className="live-listings-section" aria-labelledby="live-listings-heading">
          <div className="section-intro live-listings-intro">
            <div>
              <p className="eyebrow">RAR Scout</p>
              <h2 id="live-listings-heading">Can I buy one right now?</h2>
            </div>
            <span className="live-listings-status">{latestScoutCheck ? `Last Scout scan ${formatDate(latestScoutCheck)}` : liveProfileIds.length ? "Waiting for first scan" : "Not monitored yet"}</span>
          </div>
          {/* The observation record, stated before the listings themselves,
              because on a book with nothing live it is the answer. RAR never
              says "out of print" — it says how often it looked and when it
              last saw one, which is a fact rather than an inference. */}
          <div className={`availability-callout is-${availability.status}`}>
            <div>
              <span className="lab">Availability</span>
              <strong>{availability.label}</strong>
            </div>
            <p>{availability.detail}</p>
          </div>

          <p className="section-copy">{isMagazine
            ? `These are asking prices on eBay right now, not sold prices. RAR only surfaces listings that match ${issueLabel || "this issue"}; always inspect the source before buying. Nothing here affects the value or chart above.`
            : "These are asking prices on eBay right now, not sold prices, covering every printing of this manga. We only show listings whose title clearly matches this series and volume — always check the listing yourself before buying. Nothing here affects the value or the chart above."}</p>
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
              <p>{liveProfileIds.length ? "We only show listings that are still live when you look. Check back after the next scan." : `This ${isMagazine ? "magazine issue" : "manga"} needs an exact-edition eBay search set up before listings can appear here.`}</p>
            </div>
          )}
          <p className="availability-caveat">{AVAILABILITY_CAVEAT}</p>
        </section>

        <details className="edition-disclosure edition-evidence-section" open={isMagazine || firstPrintVerifiedCount > 0}>
          <summary><span><small>How we know this is what we say it is</small>The proof behind this page</span><span className="disclosure-hint">{isMagazine ? "Issue identifiers and sources" : firstPrintVerifiedCount > 0 ? "First-print proof on file" : "Identifiers and proof"}</span></summary>
          <div className="edition-disclosure-content">
            <p className="section-copy">{isMagazine
              ? "A magazine issue is identified by its title, year, printed issue number and cumulative issue number. RAR matches sales against that exact identity; a similar cover or a seller mentioning the magazine name alone is not enough."
              : "Knowing which book this is and proving a specific copy was a first printing are two different things. The second needs a photo of the copyright page from the exact copy that sold — a famous title is not proof, and neither is a seller saying so."}</p>
          <div className="edition-evidence-grid">
            {isMagazine ? (
              <>
                <div><span>Printed issue</span><strong>{issueLabel || "Issue number needed"}</strong><small>{[edition.publisher, edition.release_date ? formatDate(edition.release_date) : null].filter(Boolean).join(" · ")}</small></div>
                <div><span>Cumulative issue</span><strong>{edition.cumulative_issue_no ? `No. ${edition.cumulative_issue_no}` : "Not recorded"}</strong><small>The running identifier across the magazine&apos;s full publication history.</small></div>
                <div><span>Sales on file</span><strong>{observedSales.length} sale{observedSales.length === 1 ? "" : "s"}</strong><small>Every sale still needs a working source and an exact-issue match.</small></div>
              </>
            ) : (
              <>
                <div><span>Which book this is</span><strong>{edition.isbn_13 ?? edition.isbn_10 ?? "ISBN still needed"}</strong><small>{[edition.publisher, edition.release_date ? formatDate(edition.release_date) : null].filter(Boolean).join(" · ") || "Publisher or release date still needed"}</small></div>
                <div><span>First-print proof</span><strong>{firstPrintVerifiedCount > 0 ? `${firstPrintVerifiedCount} proven sale${firstPrintVerifiedCount === 1 ? "" : "s"}` : "Not yet proven"}</strong><small>{firstPrintVerifiedCount > 0 ? "See the First-print sales tab above." : "No sale has a copyright-page photo yet."}</small></div>
                <div><span>Other sales on file</span><strong>{otherSales.length} sale{otherSales.length === 1 ? "" : "s"}</strong><small>Later printings, and copies whose printing we could not identify — see the Other tab above.</small></div>
              </>
            )}
          </div>
          <div className="evidence-checklist" aria-label="RAR evidence checklist">
            <p className="eyebrow">RAR evidence checklist</p>
            <div>
              <span className={edition.is_verified ? "checked" : "needed"}>{edition.is_verified ? "✓" : "-"}</span>
              <strong>Publication record</strong>
              <small>{edition.is_verified ? "Catalogue record reviewed" : "Still awaiting catalogue review"}</small>
            </div>
            {isMagazine ? (
              <div>
                <span className={edition.issue_year && edition.issue_number_label ? "checked" : "needed"}>{edition.issue_year && edition.issue_number_label ? "✓" : "-"}</span>
                <strong>Issue identity</strong>
                <small>{edition.cumulative_issue_no ? `Year, issue and cumulative No. ${edition.cumulative_issue_no} recorded` : "Year and issue number recorded"}</small>
              </div>
            ) : (
              <div>
                <span className={edition.isbn_13 || edition.isbn_10 ? "checked" : "needed"}>{edition.isbn_13 || edition.isbn_10 ? "✓" : "-"}</span>
                <strong>Identifier</strong>
                <small>{edition.isbn_13 || edition.isbn_10 ? "ISBN recorded" : "ISBN still needed"}</small>
              </div>
            )}
            <div>
              <span className={edition.release_date ? "checked" : "needed"}>{edition.release_date ? "✓" : "-"}</span>
              <strong>Publication date</strong>
              <small>{edition.release_date ? "Date recorded" : "Date still needed"}</small>
            </div>
            {!isMagazine ? (
              <div>
                <span className={firstPrintVerifiedCount > 0 ? "checked" : "needed"}>{firstPrintVerifiedCount > 0 ? "✓" : "-"}</span>
                <strong>Printing proof</strong>
                <small>{firstPrintVerifiedCount > 0 ? "Copyright page linked to a specific sale" : "No sale has been proven a first print yet"}</small>
              </div>
            ) : null}
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
              <p className="section-copy">Why this particular {isMagazine ? "issue" : "book"} is worth knowing about. A note about its history is not a prediction about its price.</p>
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
          <summary><span><small>Provenance</small>Catalogue sources</span><span className="disclosure-hint">{catalogueSourceCount} linked source{catalogueSourceCount === 1 ? "" : "s"}</span></summary>
          <div className="edition-disclosure-content">
          {catalogueSourceCount ? (
            <div className="source-list">
              {sourceLinks.map((source) => (
                <a className="source-card" href={source.source_record_url} target="_blank" rel="noreferrer" key={source.source_record_url}>
                  <span>{sourceNames.get(source.source_id) ?? "Catalogue source"}</span>
                  <strong>View original record ↗</strong>
                  {source.verification_notes ? <small>{source.verification_notes}</small> : null}
                </a>
              ))}
              {profileSourceIsSeparate && seriesProfile ? (
                <a className="source-card" href={seriesProfile.source_url} target="_blank" rel="noreferrer">
                  <span>{seriesProfile.source_name}</span>
                  <strong>Series introduction source ↗</strong>
                  <small>Supports the reader-facing series summary near the top of this page.</small>
                </a>
              ) : null}
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
