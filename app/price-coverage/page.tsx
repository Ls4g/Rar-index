import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import StaffNav from "@/components/StaffNav";
import ListingOutcomesPanel, { type OutcomeCapability, type OutcomeRow } from "@/components/ListingOutcomesPanel";
import { readWatchToSaleMetrics } from "@/lib/watchToSale";
import { probeOutcomeProviders } from "@/lib/listingOutcomeProviders";
import {
  assessEditionCoverage,
  coverageSummary,
  COVERAGE_STATE_LABEL,
  sortCoverage,
  type CoverageEdition,
  type EditionCoverage,
  buildSeriesOptions,
  seriesKey,
} from "@/lib/editionPriceCoverage";
import type { SeriesSale } from "@/lib/priceSeries";
import { isbnForSearch } from "@/lib/apifySoldSearch";
import { MIN_COMPARABLE_SALES } from "@/lib/printClassification";
import FindSalesButton from "@/components/FindSalesButton";
import PrintClassificationDecisionForm from "@/components/PrintClassificationDecisionForm";
import { comparableSalesNeeded } from "@/lib/editionPriceCoverage";
import { isCurrentSalesFinding, isOlderWatchedListing } from "@/lib/salesInbox";
import { apifyReviewDraft } from "@/lib/apifyReviewDraft";
import { outcomeIsBestOffer } from "@/lib/outcomeSaleConfirmation";
import { prepareSaleDecision, type SaleCheckEvidence } from "@/lib/preparedSaleDecision";
import PreparedSalesInbox, { type NeedsEvidenceItem } from "@/components/PreparedSalesInbox";

// Getting a current price onto every edition.
//
// This replaced /listing-outcomes, which listed 2,945 individual watched
// listings behind eight filter tabs and three view tabs. 636 were nominally
// "worth checking" and, over two and a half months, three had ever been opened
// by a person. The page was not hard to read so much as impossible to finish,
// and the number actually being aimed at was nowhere on it.
//
// So the list here is editions. There are 235, the count only goes up, and a
// priced edition needs no more work -- which turns an endless queue into a
// checklist with a visible end. Open one edition and you get only its own
// listings, with the same decision controls as before and none of the filters,
// because one edition's listings do not need navigating.
export const dynamic = "force-dynamic";

const EDITION_COLUMNS = "id,title,series,volume_number,language,isbn_13";
const SALE_COLUMNS =
  "id,edition_id,sold_date,sale_price,currency,listing_title,source_listing_url,match_status,sale_status,is_verified,grading_company,grade_label,print_classification,printing_proof_url,known_printing_number";
const OUTCOME_COLUMNS =
  "id,external_id,marketplace,status,edition_id,profile_id,listing_title,image_url,source_listing_url,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,bid_count,scheduled_end_at,first_seen_at,last_seen_at,outcome_reason,outcome_provider,discovery_provider:original_snapshot->>provider,original_snapshot,match_assessment,check_attempts,next_check_at,last_error,reviewed_by,resulting_observation_id,edition:manga_editions(title,series,volume_number,language,publisher,isbn_13,format)";

type Admin = ReturnType<typeof getSupabaseAdmin>;

type StaffVerifiedSale = SeriesSale & {
  id: string;
  edition_id: string;
  listing_title: string | null;
  source_listing_url: string | null;
  sale_status: string;
  is_verified: boolean;
  printing_proof_url: string | null;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Read a whole table in pages. A capped query is not a total, and this page's
 * headline number is a count over every edition -- a single 1,000-row default
 * would understate it and look plausible doing so.
 */
async function readAll<T>(admin: Admin, table: string, columns: string, equals?: { column: string; value: string }) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const query = admin.from(table).select(columns).order("id", { ascending: true }).range(from, from + 999);
    const { data, error } = await (equals ? query.eq(equals.column, equals.value) : query);
    if (error) throw new Error(`${table} could not be read: ${error.message}`);
    const batch = (data ?? []) as unknown as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

function editionLabel(edition: { title?: string | null; series?: string | null; volume_number?: string | number | null; language?: string | null } | null) {
  if (!edition) return "Unknown edition";
  const volume = edition.volume_number === null || edition.volume_number === undefined || edition.volume_number === ""
    ? "" : ` vol. ${edition.volume_number}`;
  return `${edition.series ?? edition.title ?? "Unknown"}${volume}${edition.language ? ` · ${edition.language}` : ""}`;
}

type OutcomeRecord = {
  id: string; external_id: string; marketplace: string; status: string; edition_id: string; profile_id: string | null;
  listing_title: string; image_url: string | null; source_listing_url: string;
  asking_price: number | null; currency: string | null;
  sold_price: number | null; sold_currency: string | null; sold_at: string | null;
  buying_format: string | null; bid_count: number | null;
  scheduled_end_at: string | null; first_seen_at: string; last_seen_at: string;
  outcome_reason: string | null; outcome_provider: string | null; discovery_provider: string | null;
  original_snapshot: unknown;
  match_assessment: { score?: number; confidence?: string; reasons?: string[]; conflicts?: string[] } | null;
  check_attempts: number; next_check_at: string | null; last_error: string | null;
  reviewed_by: string | null; resulting_observation_id: string | null;
  edition: { title?: string | null; series?: string | null; volume_number?: string | number | null; language?: string | null; publisher?: string | null; isbn_13?: string | null; format?: string | null } | null;
};

function toOutcomeRow(record: OutcomeRecord, checks: OutcomeRow["checks"], evidence: SaleCheckEvidence[] = []): OutcomeRow {
  return {
    id: record.id,
    externalId: record.external_id,
    status: record.status,
    editionLabel: editionLabel(record.edition),
    editionDetail: [record.edition?.publisher, record.edition?.isbn_13 ? `ISBN ${record.edition.isbn_13}` : null, record.edition?.format].filter(Boolean).join(" · "),
    editionId: record.edition_id,
    profileId: record.profile_id,
    listingTitle: record.listing_title,
    imageUrl: record.image_url,
    sourceListingUrl: record.source_listing_url,
    askingPrice: record.asking_price,
    currency: record.currency,
    soldPrice: record.sold_price,
    soldCurrency: record.sold_currency,
    soldAt: record.sold_at,
    apifyDraft: apifyReviewDraft(record.original_snapshot, outcomeIsBestOffer(record.buying_format, record.listing_title)),
    preparedSale: prepareSaleDecision({
      id: record.id, externalId: record.external_id, status: record.status,
      sourceListingUrl: record.source_listing_url, listingTitle: record.listing_title,
      soldPrice: record.sold_price, soldCurrency: record.sold_currency, soldAt: record.sold_at,
      buyingFormat: record.buying_format, matchConflicts: record.match_assessment?.conflicts ?? [],
      matchConfidence: record.match_assessment?.confidence ?? null, checks: evidence,
    }),
    buyingFormat: record.buying_format,
    bidCount: record.bid_count,
    scheduledEndAt: record.scheduled_end_at,
    firstSeenAt: record.first_seen_at,
    lastSeenAt: record.last_seen_at,
    outcomeReason: record.outcome_reason,
    outcomeProvider: record.outcome_provider,
    matchScore: record.match_assessment?.score ?? null,
    matchConfidence: record.match_assessment?.confidence ?? null,
    matchReasons: record.match_assessment?.reasons ?? [],
    matchConflicts: record.match_assessment?.conflicts ?? [],
    checkAttempts: record.check_attempts,
    nextCheckAt: record.next_check_at,
    lastError: record.last_error,
    reviewedBy: record.reviewed_by,
    observationId: record.resulting_observation_id,
    checks,
  };
}

async function loadCoverage(admin: Admin) {
  const [editions, sales, outcomes] = await Promise.all([
    readAll<CoverageEdition>(admin, "manga_editions", EDITION_COLUMNS),
    readAll<StaffVerifiedSale>(admin, "price_observations", SALE_COLUMNS,
      { column: "match_status", value: "verified_match" }),
    readWorklistOutcomes(admin),
  ]);

  const salesByEdition = new Map<string, SeriesSale[]>();
  for (const sale of sales) {
    const group = salesByEdition.get(sale.edition_id);
    if (group) group.push(sale);
    else salesByEdition.set(sale.edition_id, [sale]);
  }

  const waitingByEdition = new Map<string, number>();
  const legacyByEdition = new Map<string, number>();
  const editionsById = new Map(editions.map((edition) => [edition.id, edition]));
  const pending: NeedsEvidenceItem[] = [];
  for (const outcome of outcomes.sort((left, right) => right.last_seen_at.localeCompare(left.last_seen_at))) {
    if (isCurrentSalesFinding(outcome)) {
      waitingByEdition.set(outcome.edition_id, (waitingByEdition.get(outcome.edition_id) ?? 0) + 1);
      pending.push({
        id: outcome.id, editionId: outcome.edition_id,
        editionLabel: editionLabel(editionsById.get(outcome.edition_id) ?? null),
        listingTitle: outcome.listing_title,
        reason: outcome.status === "sold_candidate" ? "Sale details need a closer review."
          : outcome.outcome_reason ?? "The completed sale and paid amount have not been established.",
      });
    }
    else if (isOlderWatchedListing(outcome)) legacyByEdition.set(outcome.edition_id, (legacyByEdition.get(outcome.edition_id) ?? 0) + 1);
  }

  const rows = sortCoverage(editions.map((edition) =>
    assessEditionCoverage(edition, salesByEdition.get(edition.id) ?? [], waitingByEdition.get(edition.id) ?? 0)));
  return { rows, summary: coverageSummary(rows), legacyByEdition, pending };
}

type WorklistOutcome = {
  id: string; edition_id: string; listing_title: string; status: string;
  outcome_reason: string | null; last_seen_at: string; discovery_provider: string | null;
  reviewed_by: string | null; resulting_observation_id: string | null;
  check_attempts: number; next_check_at: string | null;
};

async function readWorklistOutcomes(admin: Admin) {
  const rows: WorklistOutcome[] = [];
  for (let from = 0; ; from += 1000) {
    // The 5-check unknowns are historical records, not a queue. Exclude them
    // at the database so Price coverage no longer downloads thousands of old
    // rows on every visit. They remain available in an edition's full history.
    const { data, error } = await admin.from("listing_outcomes")
      .select("id,edition_id,listing_title,status,outcome_reason,last_seen_at,discovery_provider:original_snapshot->>provider,reviewed_by,resulting_observation_id,check_attempts,next_check_at")
      .in("status", ["ended_pending_check", "sold_candidate", "ambiguous", "inaccessible"])
      .is("reviewed_by", null).is("resulting_observation_id", null)
      .or("status.neq.ambiguous,check_attempts.lt.5,next_check_at.not.is.null")
      .order("id", { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`Sales findings could not be read: ${error.message}`);
    const batch = (data ?? []) as WorklistOutcome[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

async function loadPreparedInbox(admin: Admin) {
  const records: OutcomeRecord[] = [];
  for (let from = 0; ; from += 250) {
    const { data, error } = await admin.from("listing_outcomes").select(OUTCOME_COLUMNS)
      .eq("status", "sold_candidate").is("reviewed_by", null).is("resulting_observation_id", null)
      .order("last_seen_at", { ascending: false }).range(from, from + 249);
    if (error) throw new Error(`Sales inbox could not be read: ${error.message}`);
    const batch = (data ?? []) as unknown as OutcomeRecord[];
    records.push(...batch);
    if (batch.length < 250) break;
  }
  const checksByOutcome = new Map<string, SaleCheckEvidence[]>();
  for (let from = 0; from < records.length; from += 100) {
    const ids = records.slice(from, from + 100).map((record) => record.id);
    const { data, error } = await admin.from("listing_outcome_checks")
      .select("outcome_id,provider,listing_state,http_status,checked_at,raw_response")
      .in("outcome_id", ids).order("checked_at", { ascending: false });
    if (error) throw new Error(`Sales evidence could not be read: ${error.message}`);
    for (const check of data ?? []) {
      const list = checksByOutcome.get(check.outcome_id) ?? [];
      list.push({ provider: check.provider, state: check.listing_state, httpStatus: check.http_status,
        checkedAt: check.checked_at, rawResponse: check.raw_response });
      checksByOutcome.set(check.outcome_id, list);
    }
  }
  const rows = records.map((record) => toOutcomeRow(record, [], checksByOutcome.get(record.id) ?? []));
  return { ready: rows.filter((row) => row.preparedSale?.ready), needsEvidence: rows.filter((row) => !row.preparedSale?.ready) };
}

async function loadReviewRows(admin: Admin, ids: string[]) {
  if (!ids.length) return [];
  const [{ data: records, error: recordError }, { data: checks, error: checkError }] = await Promise.all([
    admin.from("listing_outcomes").select(OUTCOME_COLUMNS).in("id", ids),
    admin.from("listing_outcome_checks")
      .select("outcome_id,provider,attempt_number,listing_state,http_status,detail,checked_at,raw_response")
      .in("outcome_id", ids).order("checked_at", { ascending: false }),
  ]);
  if (recordError || checkError) throw new Error("The sales findings could not be loaded for review.");
  const evidenceById = new Map<string, SaleCheckEvidence[]>();
  const checksById = new Map<string, OutcomeRow["checks"]>();
  for (const check of checks ?? []) {
    const evidence = evidenceById.get(check.outcome_id) ?? [];
    evidence.push({ provider: check.provider, state: check.listing_state, httpStatus: check.http_status,
      checkedAt: check.checked_at, rawResponse: check.raw_response });
    evidenceById.set(check.outcome_id, evidence);
    const visible = checksById.get(check.outcome_id) ?? [];
    visible.push({ provider: check.provider, attempt: check.attempt_number ?? 0, state: check.listing_state,
      httpStatus: check.http_status, detail: check.detail, checkedAt: check.checked_at });
    checksById.set(check.outcome_id, visible);
  }
  const byId = new Map(((records ?? []) as unknown as OutcomeRecord[]).map((record) => [record.id, record]));
  return ids.flatMap((id) => {
    const record = byId.get(id);
    return record ? [toOutcomeRow(record, checksById.get(id) ?? [], evidenceById.get(id) ?? [])] : [];
  });
}

function CoverageRow({ row }: { row: EditionCoverage }) {
  const hasIsbn = Boolean(isbnForSearch(row.edition.isbn_13));
  const missing = comparableSalesNeeded(row);
  return (
    <li className={`price-coverage-row is-${row.state}`}>
      <Link className="price-coverage-link" href={`/price-coverage?edition=${row.edition.id}`}>
        <span className="price-coverage-name">{editionLabel(row.edition)}</span>
        <span className="price-coverage-state">{missing ? `${missing} sale${missing === 1 ? "" : "s"} missing` : row.state === "stale" ? "Needs a recent sale" : COVERAGE_STATE_LABEL[row.state]}</span>
      </Link>
      <p className="price-coverage-help">
        {row.comparableSales} of {MIN_COMPARABLE_SALES} comparable sales{row.groupLabel ? ` · ${row.groupLabel}` : ""}
        {row.waitingToCheck ? ` · ${row.waitingToCheck} finding${row.waitingToCheck === 1 ? "" : "s"} ready to review` : ""}
      </p>
      <div className="price-coverage-actions">
        {/* Listings already waiting outrank a fresh search: they are a decision
            away from a price and cost nothing, where a search costs money. */}
        {row.waitingToCheck ? (
          <Link className="price-coverage-check" href={`/price-coverage?edition=${row.edition.id}`}>
            Review {row.waitingToCheck} finding{row.waitingToCheck === 1 ? "" : "s"}
          </Link>
        ) : null}
        {hasIsbn
          ? <FindSalesButton editionId={row.edition.id} label={row.waitingToCheck ? "Find more sales" : "Find sales"} />
          : <span className="price-coverage-group">No ISBN, so no search can identify it.</span>}
      </div>
    </li>
  );
}

export default async function PriceCoveragePage({ searchParams }: {
  searchParams: Promise<{ edition?: string | string[]; outcome?: string | string[]; show?: string | string[]; series?: string | string[]; searched?: string | string[]; found?: string | string[]; queued?: string | string[]; known?: string | string[]; excluded?: string | string[]; recent?: string | string[] }>;
}) {
  const parameters = await searchParams;
  const admin = getSupabaseAdmin();
  const focusOutcomeId = one(parameters.outcome) ?? null;
  let editionId = one(parameters.edition) ?? null;

  // A link from Decisions names a listing, not an edition. Resolve it so the
  // deep link lands on the edition that listing belongs to rather than 404ing
  // or dumping the whole catalogue.
  let focusMissing = false;
  if (focusOutcomeId && !editionId) {
    const { data } = await admin.from("listing_outcomes").select("edition_id").eq("id", focusOutcomeId).maybeSingle();
    if (data?.edition_id) editionId = data.edition_id as string;
    else focusMissing = true;
  }

  // A focused listing is one the Decisions page sent here by name, so it must
  // be rendered even when it has already been settled -- otherwise the link
  // lands on a page that does not contain the listing it was about.
  if (editionId) return renderEdition(admin, editionId, focusOutcomeId, focusMissing,
    focusOutcomeId || one(parameters.show) === "all" ? "all" : one(parameters.show) === "legacy" ? "legacy" : "current", parameters);

  const [{ rows, summary, legacyByEdition, pending }, preparedInbox] = await Promise.all([
    loadCoverage(admin), loadPreparedInbox(admin),
  ]);
  const show = one(parameters.show) === "all" ? "all" : one(parameters.show) === "legacy" ? "legacy" : "todo";
  const series = (one(parameters.series) ?? "").trim();

  // Grouped case-insensitively on purpose. The catalogue holds both "One Piece"
  // and "ONE PIECE", and both spellings of "Spy x Family": a filter that
  // treated those as different series would quietly hide editions from the
  // person looking for them. The label shown is whichever spelling is most
  // common, and the duplicates remain visible in the catalogue itself to be
  // fixed there rather than papered over here.
  const seriesOptions = buildSeriesOptions(rows);
  const selected = seriesOptions.find((option) => option.key === series.toLocaleLowerCase()) ?? null;

  const inSeries = selected ? rows.filter((row) => seriesKey(row.edition.series) === selected.key) : rows;
  const seriesByEdition = new Map(rows.map((row) => [row.edition.id, seriesKey(row.edition.series)]));
  const readyIds = new Set(preparedInbox.ready.map((row) => row.id));
  const soldNeeds = new Map(preparedInbox.needsEvidence.map((row) => [row.id, row.preparedSale?.reason]));
  const needsEvidence = pending.filter((row) => !readyIds.has(row.id))
    .filter((row) => !selected || seriesByEdition.get(row.editionId) === selected.key)
    .map((row) => ({ ...row, reason: soldNeeds.get(row.id) ?? row.reason }));
  const readyRows = preparedInbox.ready.filter((row) => !selected || seriesByEdition.get(row.editionId) === selected.key);
  const reviewRows = show === "todo" ? await loadReviewRows(admin, needsEvidence.slice(0, 50).map((row) => row.id)) : [];
  const legacyRows = inSeries.filter((row) => (legacyByEdition.get(row.edition.id) ?? 0) > 0);
  const legacyCount = legacyRows.reduce((count, row) => count + (legacyByEdition.get(row.edition.id) ?? 0), 0);
  const visible = show === "all" ? inSeries : show === "legacy" ? legacyRows : inSeries.filter((row) => row.state !== "priced");

  // The headline counts whatever is being looked at. Filtering to One Piece and
  // still being told about all 235 editions would answer a question nobody
  // asked.
  const shown = selected ? coverageSummary(inSeries) : summary;
  const percent = shown.total ? Math.round((shown.priced / shown.total) * 100) : 0;
  const keepSeries = selected ? `&series=${encodeURIComponent(selected.key)}` : "";

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/review">Decisions →</Link>
        <StaffNav current="/price-coverage" />
      </header>
      <section className="catalogue-content">
        {show === "todo" ? <PreparedSalesInbox initialRows={readyRows} needsEvidence={needsEvidence} reviewRows={reviewRows} /> : null}
        <div className="price-coverage-header">
          <p className="eyebrow">{selected ? selected.label : "Price coverage"}</p>
          <h1>
            {shown.priced} of {shown.total} {selected ? "volumes" : "editions"} have a current price
          </h1>
          <div className="price-coverage-progress" role="img" aria-label={`${percent}% priced`}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="price-coverage-note">
            Each row shows how many more comparable sales it needs for a price. Find sales searches eBay through Apify, then opens the findings for your decision.
          </p>

          {/* A plain GET form, so the filter is a URL anyone can bookmark or
              send, and it works before any JavaScript has loaded. */}
          <form action="/price-coverage" className="price-coverage-filter" method="get">
            <label htmlFor="series-filter">Series</label>
            <select defaultValue={selected?.key ?? ""} id="series-filter" name="series">
              <option value="">All {seriesOptions.length} series ({summary.total} editions)</option>
              {seriesOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label} — {option.priced} of {option.total} priced
                </option>
              ))}
            </select>
            {show !== "todo" ? <input name="show" type="hidden" value={show} /> : null}
            <button type="submit">Show</button>
            {selected ? <Link className="price-coverage-group" href={show === "todo" ? "/price-coverage" : `/price-coverage?show=${show}`}>Clear</Link> : null}
          </form>

          <div className="price-coverage-tabs">
            <Link className={show === "todo" ? "is-active" : ""} href={`/price-coverage${keepSeries ? `?${keepSeries.slice(1)}` : ""}`}>
              Needs work ({shown.total - shown.priced})
            </Link>
            <Link className={show === "all" ? "is-active" : ""} href={`/price-coverage?show=all${keepSeries}`}>
              Everything ({shown.total})
            </Link>
            <Link className={show === "legacy" ? "is-active" : ""} href={`/price-coverage?show=legacy${keepSeries}`}>
              Older watched listings ({legacyCount})
            </Link>
          </div>
        </div>
        {show === "legacy" ? <p className="price-coverage-note">Older watched listings are kept here, separate from the new sales inbox. They have not been deleted or counted as sales.</p> : null}
        <ol className="price-coverage-list">
          {visible.map((row) => show === "legacy"
            ? <li className="price-coverage-row" key={row.edition.id}><Link className="price-coverage-link" href={`/price-coverage?edition=${row.edition.id}&show=legacy`}><span className="price-coverage-name">{editionLabel(row.edition)}</span><span className="price-coverage-state">{legacyByEdition.get(row.edition.id)} older listings →</span></Link></li>
            : <CoverageRow key={row.edition.id} row={row} />)}
        </ol>
        {visible.length === 0 ? <p className="outcome-message" role="status">{show === "legacy" ? "No older watched listings are waiting." : "Every edition has a current price."}</p> : null}
      </section>
    </main>
  );
}

async function renderEdition(admin: Admin, editionId: string, focusOutcomeId: string | null, focusMissing: boolean, view: "current" | "legacy" | "all", search: { searched?: string | string[]; found?: string | string[]; queued?: string | string[]; known?: string | string[]; excluded?: string | string[]; recent?: string | string[] }) {
  const currentView = view === "current" && !focusOutcomeId;
  const outcomeQuery = admin.from("listing_outcomes").select(OUTCOME_COLUMNS)
    .eq("edition_id", editionId).order("last_seen_at", { ascending: false });
  const [editionResult, outcomeResult, salesResult, totalResult] = await Promise.all([
    admin.from("manga_editions").select(EDITION_COLUMNS).eq("id", editionId).maybeSingle(),
    currentView ? outcomeQuery
      .in("status", ["ended_pending_check", "sold_candidate", "ambiguous", "inaccessible"])
      .is("reviewed_by", null).is("resulting_observation_id", null)
      .or("status.neq.ambiguous,check_attempts.lt.5,next_check_at.not.is.null") : outcomeQuery,
    admin.from("price_observations").select(SALE_COLUMNS).eq("edition_id", editionId).eq("match_status", "verified_match"),
    currentView ? admin.from("listing_outcomes").select("id", { count: "exact", head: true }).eq("edition_id", editionId)
      : Promise.resolve(null),
  ]);

  const edition = editionResult.data as CoverageEdition | null;
  const records = (outcomeResult.data ?? []) as unknown as OutcomeRecord[];
  const verifiedSales = ((salesResult.data ?? []) as unknown as StaffVerifiedSale[])
    .filter((sale) => sale.sale_status === "confirmed" && sale.is_verified);
  const unidentifiedSales = verifiedSales
    .filter((sale) => sale.print_classification === "printing_not_identified")
    .sort((left, right) => right.sale_price - left.sale_price);
  const currentRecords = records.filter(isCurrentSalesFinding);
  const legacyRecords = records.filter(isOlderWatchedListing);
  const coverage = edition
    ? assessEditionCoverage(edition, verifiedSales, currentRecords.length)
    : null;

  const { data: checkData } = records.length
    ? await admin.from("listing_outcome_checks")
      .select("outcome_id,provider,attempt_number,http_status,listing_state,detail,checked_at,raw_response")
      .in("outcome_id", records.map((record) => record.id))
      .order("checked_at", { ascending: false })
    : { data: [] };
  const checksByOutcome = new Map<string, OutcomeRow["checks"]>();
  const evidenceByOutcome = new Map<string, SaleCheckEvidence[]>();
  for (const check of (checkData ?? []) as Array<Record<string, unknown>>) {
    const id = check.outcome_id as string;
    const list = checksByOutcome.get(id) ?? [];
    list.push({
      provider: check.provider as string,
      attempt: (check.attempt_number as number) ?? 0,
      httpStatus: (check.http_status as number | null) ?? null,
      state: (check.listing_state as string | null) ?? null,
      detail: (check.detail as string | null) ?? null,
      checkedAt: check.checked_at as string,
    });
    checksByOutcome.set(id, list);
    const evidence = evidenceByOutcome.get(id) ?? [];
    evidence.push({
      provider: check.provider as string, state: check.listing_state as string | null,
      httpStatus: check.http_status as number | null, checkedAt: check.checked_at as string,
      rawResponse: check.raw_response,
    });
    evidenceByOutcome.set(id, evidence);
  }

  const convert = (record: OutcomeRecord) => toOutcomeRow(record, checksByOutcome.get(record.id) ?? [], evidenceByOutcome.get(record.id) ?? []);
  const allRows = records.map(convert);
  const outstanding = currentRecords.map(convert);
  const legacy = legacyRecords.map(convert);
  const historyCount = totalResult?.count ?? allRows.length;
  const settled = historyCount - outstanding.length - legacy.length;

  // Only what still needs deciding. Showing the whole history put 43 cards on
  // a page that said 31 needed a decision, so twelve already answered -- seven
  // marked unsold, four finished, one still live -- had to be read and skipped
  // again on every visit. Rechecking a listing you already dismissed is the
  // slowest possible way to work through a queue.
  const rows = view === "all" ? allRows : view === "legacy" ? legacy : outstanding;
  const wasSearched = one(search.searched) === "1";
  const searchCount = (key: "found" | "queued" | "known" | "excluded") => Math.max(0, Number(one(search[key]) ?? 0) || 0);

  // The compact Apify workbench needs no global watch metrics or live provider
  // probe. Those can involve additional database/API work, so only load them
  // when someone explicitly opens the advanced evidence view for one listing.
  let counts: Awaited<ReturnType<typeof readWatchToSaleMetrics>> | null = null;
  let capabilities: OutcomeCapability[] = [];
  if (focusOutcomeId || view !== "current") {
    const sample = records[0] ?? null;
    [counts, capabilities] = await Promise.all([
      readWatchToSaleMetrics(admin),
      probeOutcomeProviders(sample ? { itemId: sample.external_id, marketplace: sample.marketplace } : undefined)
        .catch((): OutcomeCapability[] => [{ provider: "eBay", available: false, canConfirmSales: false, detail: "The capability probe could not reach eBay." }]),
    ]);
  }

  // One edition's listings all fit on one page, so the panel is handed the
  // whole set and told not to draw filters. The counts it needs for paging are
  // the real totals for this edition, not of the table.
  const total = rows.length;

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/price-coverage">← All editions</Link>
        <StaffNav current="/price-coverage" />
      </header>
      <section className="catalogue-content">
        <div className="price-coverage-header">
          <p className="eyebrow">{edition ? COVERAGE_STATE_LABEL[coverage!.state] : "Edition"}</p>
          <h1>{editionLabel(edition)}</h1>
          {coverage ? (
            <p className="price-coverage-note">
              {comparableSalesNeeded(coverage)
                ? `${comparableSalesNeeded(coverage)} more comparable sale${comparableSalesNeeded(coverage) === 1 ? "" : "s"} needed for a price.`
                : coverage.state === "stale" ? "Enough comparable sales, but a recent sale is needed to refresh the price." : "This edition has a current price."}
              {" "}{outstanding.length} finding{outstanding.length === 1 ? "" : "s"} awaiting your review.
            </p>
          ) : <p className="outcome-message" role="alert">That edition could not be found.</p>}
          {wasSearched ? <p className="coverage-review-success" role="status">
            {one(search.recent) === "1" ? "Already searched recently; no second paid search was run. Review the findings below." :
              `Search complete: ${searchCount("queued")} new finding${searchCount("queued") === 1 ? "" : "s"} to review${searchCount("known") ? `, ${searchCount("known")} already known` : ""}${searchCount("excluded") ? `, ${searchCount("excluded")} excluded because they could not be safely matched or used` : ""}.`}
            {searchCount("found") === 0 && one(search.recent) !== "1" ? " No sold-index listings were found for this ISBN." : null}
          </p> : null}
          {focusMissing ? <p className="outcome-message" role="alert">That listing no longer exists, so the edition could not be opened.</p> : null}
          <div className="price-coverage-actions">
            {edition && isbnForSearch(edition.isbn_13)
              ? <FindSalesButton editionId={editionId} label={outstanding.length ? "Find more sales" : "Find sales"} />
              : null}
            {view !== "current" ? <Link className="price-coverage-group" href={`/price-coverage?edition=${editionId}`}>← New sales findings</Link> : null}
            {legacy.length && view !== "legacy" ? <Link className="price-coverage-group" href={`/price-coverage?edition=${editionId}&show=legacy`}>Older watched listings ({legacy.length})</Link> : null}
            {settled && view !== "all" ? <Link className="price-coverage-group" href={`/price-coverage?edition=${editionId}&show=all`}>All listing history ({historyCount})</Link> : null}
          </div>
        </div>
        {view === "legacy" ? <p className="price-coverage-note">These older watched listings remain available for investigation. They are not verified sales.</p> : null}
        {!focusOutcomeId && view === "current" ? <>
          <PreparedSalesInbox initialRows={outstanding.filter((row) => row.preparedSale?.ready)} needsEvidence={outstanding.filter((row) => !row.preparedSale?.ready).map((row) => ({ id: row.id, editionId: row.editionId, editionLabel: row.editionLabel, listingTitle: row.listingTitle, reason: row.preparedSale?.reason ?? "Needs a closer review" }))} reviewRows={outstanding.filter((row) => !row.preparedSale?.ready)} openNeedsEvidence />
        </> : rows.length ? (
          <ListingOutcomesPanel
            basePath={`/price-coverage?edition=${editionId}`}
            showFilters={false}
            capabilities={capabilities}
            counts={counts!}
            focusOutcomeId={focusOutcomeId}
            focusMissing={false}
            focusRedirected={false}
            page={1}
            pageCount={1}
            pageSize={total || 1}
            firstIndex={total ? 1 : 0}
            lastIndex={total}
            total={total}
            queue="all"
            queueCounts={{ worth_checking: 0, best_offer: 0, high_value: 0, conflict: 0, graded: 0, lot: 0, parked: 0, all: total }}
            renderedAt={new Date().toISOString()}
            rows={rows}
            search=""
            sort="priority"
            view="attention"
            viewCounts={{ attention: outstanding.length + legacy.length, watching: 0, finished: settled }}
          />
        ) : (
          <p className="outcome-message" role="status">
            {view === "legacy" ? "No older watched listings for this edition." : "No new findings for this edition. Run a sold-listing search for its ISBN to find some."}
          </p>
        )}
        {unidentifiedSales.length ? <details className="coverage-print-corrections" id="printing-corrections">
          <summary>Correct printing on verified sales · {unidentifiedSales.length} not identified</summary>
          <p>Use this only when a photo from the exact sold copy proves its printing. A seller saying “first print” in the title is not enough.</p>
          {unidentifiedSales.map((sale) => <details className="coverage-print-correction" key={sale.id} id={`printing-${sale.id}`}>
            <summary>{sale.listing_title || "Untitled sale"} · {sale.currency} {sale.sale_price.toFixed(2)} · {sale.sold_date ?? "Date unknown"}</summary>
            {sale.source_listing_url ? <p><a href={sale.source_listing_url} rel="noopener noreferrer" target="_blank">Open original sold listing ↗</a></p> : null}
            <PrintClassificationDecisionForm observationId={sale.id} currentClassification={sale.print_classification} currentProofUrl={sale.printing_proof_url} currentPrintingNumber={sale.known_printing_number} />
          </details>)}
        </details> : null}
      </section>
    </main>
  );
}
