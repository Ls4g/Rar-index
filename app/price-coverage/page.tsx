import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import StaffNav from "@/components/StaffNav";
import ListingOutcomesPanel, { type OutcomeCapability, type OutcomeRow } from "@/components/ListingOutcomesPanel";
import { readWatchToSaleMetrics } from "@/lib/watchToSale";
import { probeOutcomeProviders } from "@/lib/listingOutcomeProviders";
import {
  assessEditionCoverage,
  coverageStateHelp,
  coverageSummary,
  COVERAGE_STATE_LABEL,
  PRICE_CURRENT_WITHIN_DAYS,
  sortCoverage,
  type CoverageEdition,
  type EditionCoverage,
} from "@/lib/editionPriceCoverage";
import type { SeriesSale } from "@/lib/priceSeries";
import { isbnForSearch } from "@/lib/apifySoldSearch";
import FindSalesButton from "@/components/FindSalesButton";

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
  "edition_id,sold_date,sale_price,currency,grading_company,grade_label,print_classification,known_printing_number";
const OUTCOME_COLUMNS =
  "id,external_id,marketplace,status,edition_id,profile_id,listing_title,image_url,source_listing_url,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,bid_count,scheduled_end_at,first_seen_at,last_seen_at,outcome_reason,outcome_provider,match_assessment,check_attempts,next_check_at,last_error,reviewed_by,resulting_observation_id,edition:manga_editions(title,series,volume_number,language)";

// A listing still wanting a human decision. Anything a person has already
// settled, or that produced a sale, is finished and must not be counted as
// outstanding work.
const OUTSTANDING_STATUSES = ["ended_pending_check", "sold_candidate", "ambiguous", "inaccessible"];

type Admin = ReturnType<typeof getSupabaseAdmin>;

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

function money(value: number | null, currency: string | null) {
  if (value === null || !currency) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

type OutcomeRecord = {
  id: string; external_id: string; marketplace: string; status: string; edition_id: string; profile_id: string | null;
  listing_title: string; image_url: string | null; source_listing_url: string;
  asking_price: number | null; currency: string | null;
  sold_price: number | null; sold_currency: string | null; sold_at: string | null;
  buying_format: string | null; bid_count: number | null;
  scheduled_end_at: string | null; first_seen_at: string; last_seen_at: string;
  outcome_reason: string | null; outcome_provider: string | null;
  match_assessment: { score?: number; confidence?: string; reasons?: string[]; conflicts?: string[] } | null;
  check_attempts: number; next_check_at: string | null; last_error: string | null;
  reviewed_by: string | null; resulting_observation_id: string | null;
  edition: { title?: string | null; series?: string | null; volume_number?: string | number | null; language?: string | null } | null;
};

function toOutcomeRow(record: OutcomeRecord, checks: OutcomeRow["checks"]): OutcomeRow {
  return {
    id: record.id,
    externalId: record.external_id,
    status: record.status,
    editionLabel: editionLabel(record.edition),
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
    readAll<SeriesSale & { edition_id: string }>(admin, "price_observations", SALE_COLUMNS,
      { column: "match_status", value: "verified_match" }),
    readAll<{ edition_id: string; status: string; reviewed_by: string | null; resulting_observation_id: string | null }>(
      admin, "listing_outcomes", "id,edition_id,status,reviewed_by,resulting_observation_id"),
  ]);

  const salesByEdition = new Map<string, SeriesSale[]>();
  for (const sale of sales) {
    const group = salesByEdition.get(sale.edition_id);
    if (group) group.push(sale);
    else salesByEdition.set(sale.edition_id, [sale]);
  }

  const waitingByEdition = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.reviewed_by || outcome.resulting_observation_id) continue;
    if (!OUTSTANDING_STATUSES.includes(outcome.status)) continue;
    waitingByEdition.set(outcome.edition_id, (waitingByEdition.get(outcome.edition_id) ?? 0) + 1);
  }

  const rows = sortCoverage(editions.map((edition) =>
    assessEditionCoverage(edition, salesByEdition.get(edition.id) ?? [], waitingByEdition.get(edition.id) ?? 0)));
  return { rows, summary: coverageSummary(rows) };
}

function CoverageRow({ row }: { row: EditionCoverage }) {
  const hasIsbn = Boolean(isbnForSearch(row.edition.isbn_13));
  return (
    <li className={`price-coverage-row is-${row.state}`}>
      <Link className="price-coverage-link" href={`/price-coverage?edition=${row.edition.id}`}>
        <span className="price-coverage-name">{editionLabel(row.edition)}</span>
        <span className="price-coverage-state">{COVERAGE_STATE_LABEL[row.state]}</span>
        <span className="price-coverage-price">{money(row.medianPrice, row.currency)}</span>
      </Link>
      <p className="price-coverage-help">
        {coverageStateHelp(row)}
        {row.groupLabel && row.state !== "none" ? <span className="price-coverage-group"> {row.groupLabel}.</span> : null}
      </p>
      <div className="price-coverage-actions">
        {/* Listings already waiting outrank a fresh search: they are a decision
            away from a price and cost nothing, where a search costs money. */}
        {row.waitingToCheck ? (
          <Link className="price-coverage-check" href={`/price-coverage?edition=${row.edition.id}`}>
            Check {row.waitingToCheck} waiting
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
  searchParams: Promise<{ edition?: string | string[]; outcome?: string | string[]; show?: string | string[] }>;
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

  if (editionId) return renderEdition(admin, editionId, focusOutcomeId, focusMissing);

  const { rows, summary } = await loadCoverage(admin);
  const show = one(parameters.show) ?? "todo";
  const visible = show === "all" ? rows : rows.filter((row) => row.state !== "priced");
  const percent = summary.total ? Math.round((summary.priced / summary.total) * 100) : 0;

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/review">Decisions →</Link>
        <StaffNav current="/price-coverage" />
      </header>
      <section className="catalogue-content">
        <div className="price-coverage-header">
          <p className="eyebrow">Price coverage</p>
          <h1>{summary.priced} of {summary.total} editions have a current price</h1>
          <div className="price-coverage-progress" role="img" aria-label={`${percent}% of editions priced`}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="price-coverage-note">
            A current price means at least three sales of the same printing, in the same currency, the newest within{" "}
            {PRICE_CURRENT_WITHIN_DAYS} days. {summary.thin} editions have some sales but not enough, {summary.stale} have
            enough but out of date, and {summary.none} have none yet.
          </p>
          <p className="price-coverage-note">
            {summary.waitingToCheck} listing{summary.waitingToCheck === 1 ? "" : "s"} across all editions are waiting for a
            decision. Open an edition to work through only its own.
          </p>
          <div className="price-coverage-tabs">
            <Link className={show === "todo" ? "is-active" : ""} href="/price-coverage">Needs work ({summary.total - summary.priced})</Link>
            <Link className={show === "all" ? "is-active" : ""} href="/price-coverage?show=all">Everything ({summary.total})</Link>
          </div>
        </div>
        <ol className="price-coverage-list">
          {visible.map((row) => <CoverageRow key={row.edition.id} row={row} />)}
        </ol>
        {visible.length === 0 ? <p className="outcome-message" role="status">Every edition has a current price.</p> : null}
      </section>
    </main>
  );
}

async function renderEdition(admin: Admin, editionId: string, focusOutcomeId: string | null, focusMissing: boolean) {
  const [editionResult, outcomeResult, salesResult] = await Promise.all([
    admin.from("manga_editions").select(EDITION_COLUMNS).eq("id", editionId).maybeSingle(),
    admin.from("listing_outcomes").select(OUTCOME_COLUMNS).eq("edition_id", editionId).order("last_seen_at", { ascending: false }),
    admin.from("price_observations").select(SALE_COLUMNS).eq("edition_id", editionId).eq("match_status", "verified_match"),
  ]);

  const edition = editionResult.data as CoverageEdition | null;
  const records = (outcomeResult.data ?? []) as unknown as OutcomeRecord[];
  const coverage = edition
    ? assessEditionCoverage(edition, (salesResult.data ?? []) as unknown as SeriesSale[],
      records.filter((record) => !record.reviewed_by && !record.resulting_observation_id && OUTSTANDING_STATUSES.includes(record.status)).length)
    : null;

  const { data: checkData } = records.length
    ? await admin.from("listing_outcome_checks")
      .select("outcome_id,provider,attempt_number,http_status,listing_state,detail,checked_at")
      .in("outcome_id", records.map((record) => record.id))
      .order("checked_at", { ascending: false })
    : { data: [] };
  const checksByOutcome = new Map<string, OutcomeRow["checks"]>();
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
  }

  const rows = records.map((record) => toOutcomeRow(record, checksByOutcome.get(record.id) ?? []));
  const outstanding = rows.filter((row) => !row.reviewedBy && !row.observationId && OUTSTANDING_STATUSES.includes(row.status));

  const sample = records[0] ?? null;
  const [counts, capabilities] = await Promise.all([
    readWatchToSaleMetrics(admin),
    probeOutcomeProviders(sample ? { itemId: sample.external_id, marketplace: sample.marketplace } : undefined)
      .catch((): OutcomeCapability[] => [{ provider: "eBay", available: false, canConfirmSales: false, detail: "The capability probe could not reach eBay." }]),
  ]);

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
              {coverage.state === "priced" || coverage.state === "stale"
                ? `Median ${money(coverage.medianPrice, coverage.currency)} from ${coverage.comparableSales} comparable sales${coverage.groupLabel ? ` (${coverage.groupLabel})` : ""}.`
                : coverage.comparableSales
                  ? `${coverage.comparableSales} sale${coverage.comparableSales === 1 ? "" : "s"} so far — not enough for a price yet.`
                  : "No verified sales yet."}
              {" "}{outstanding.length} listing{outstanding.length === 1 ? "" : "s"} below need a decision.
            </p>
          ) : <p className="outcome-message" role="alert">That edition could not be found.</p>}
          {focusMissing ? <p className="outcome-message" role="alert">That listing no longer exists, so the edition could not be opened.</p> : null}
          {edition && isbnForSearch(edition.isbn_13) ? (
            <div className="price-coverage-actions">
              <FindSalesButton editionId={editionId} label={rows.length ? "Find more sales" : "Find sales"} />
            </div>
          ) : null}
        </div>
        {rows.length ? (
          <ListingOutcomesPanel
            basePath={`/price-coverage?edition=${editionId}`}
            showFilters={false}
            capabilities={capabilities}
            counts={counts}
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
            viewCounts={{ attention: total, watching: 0, finished: 0 }}
          />
        ) : (
          <p className="outcome-message" role="status">
            No listings have been found for this edition yet. Run a sold-listing search for its ISBN to find some.
          </p>
        )}
      </section>
    </main>
  );
}
