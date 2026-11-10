import { assessEditionCoverage, comparableSalesNeeded, sortCoverage, type CoverageEdition } from "./editionPriceCoverage.ts";
import { isbnForSearch, MAX_DAILY_BATCH_SERIES, SEARCH_DAYS } from "./apifySoldSearch.ts";
import { isCurrentSalesFinding, type SalesInboxOutcome } from "./salesInbox.ts";
import type { SeriesSale } from "./priceSeries.ts";

export const MAX_DAILY_APIFY_SEARCHES = 10;
// A SUCCEEDED search is not repeated for this long: it would mostly return
// the same listings and charge again for them.
export const SCHEDULED_ISBN_REFRESH_DAYS = 30;
// A search that FAILED (or never recorded finishing) found nothing, so it must
// not lock the edition out for a month. It may be retried after this gap; the
// 12-hour claim cooldown still prevents a same-day double charge.
export const FAILED_SEARCH_RETRY_DAYS = 2;
// Keep this projection aligned with SeriesSale/buildPriceSeries. Without the
// title and human grading review, an unresolved graded listing can appear raw
// and incorrectly make an edition look fully covered to the daily search.
export const SCHEDULED_SALE_COLUMNS = "id,edition_id,sold_date,sale_price,currency,grading_company,grade_label,grading_reviewed_at,listing_title,print_classification,known_printing_number";

export function configuredDailySearchLimit(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return 0;
  const count = Number(value);
  return count >= 1 && count <= MAX_DAILY_APIFY_SEARCHES ? count : 0;
}

export type DailySearchTarget = { editionId: string; isbn: string };
export type ScheduledSearchReason =
  | "needs_recent_sale" // enough comparable sales, but none recent enough to quote
  | "one_sale_short" // one comparable sale from a first price
  | "two_sales_short" // two comparable sales from a first price
  | "proven_series" | "exploration" | "coverage_fallback";
export type ScheduledSearchTarget = DailySearchTarget & { reason: ScheduledSearchReason };
export type ScheduledSearchHistory = {
  isbn_13: string;
  requested_edition_id: string | null;
  last_started_at: string;
  last_status: string;
  last_result_count: number | null;
};

export type SearchLogEntry = string | Pick<ScheduledSearchHistory, "last_started_at" | "last_status">;

/**
 * Whether an ISBN's last search still keeps it out of today's selection.
 *
 * Only a search that succeeded earns the 30-day refresh gap. A failed search
 * (and a "running" row whose run never recorded an end, e.g. a killed
 * invocation) is retried after FAILED_SEARCH_RETRY_DAYS. A bare timestamp is
 * the older call shape and is treated as a succeeded search.
 */
export function searchRefreshBlocked(entry: SearchLogEntry | undefined, now = new Date()): boolean {
  if (!entry) return false;
  const startedAt = Date.parse(typeof entry === "string" ? entry : entry.last_started_at);
  if (!Number.isFinite(startedAt)) return false;
  const succeeded = typeof entry === "string" || entry.last_status === "succeeded";
  const days = succeeded ? SCHEDULED_ISBN_REFRESH_DAYS : FAILED_SEARCH_RETRY_DAYS;
  return now.getTime() - startedAt < days * 86_400_000;
}

/**
 * Spend the fixed daily batch on the editions closest to a current price,
 * then on series with recent verified sales, then on one unproven series.
 *
 * Tier order: (a) enough comparable sales but none recent ("stale"),
 * (b) one comparable sale short, (c) two short. These take every slot they
 * can, one edition per series. Within a tier an ISBN whose last search failed
 * goes after one that has not failed, so a permanently failing ISBN cannot
 * crowd out the rest; the order is otherwise sortCoverage's stable order.
 *
 * These are search priorities only: a series sale never establishes a sale
 * for another edition.
 */
export function selectScheduledSearchTargets(
  editions: CoverageEdition[],
  sales: Array<SeriesSale & { edition_id: string }>,
  outcomes: Array<SalesInboxOutcome & { edition_id: string }>,
  history: ScheduledSearchHistory[] = [],
  now = new Date(),
  limit = MAX_DAILY_BATCH_SERIES,
): ScheduledSearchTarget[] {
  const historyByIsbn = new Map<string, ScheduledSearchHistory>(history.map((row) => [row.isbn_13, row]));
  const eligible = dailySearchTargets(editions, sales, outcomes, historyByIsbn, now);
  const byId = new Map(editions.map((edition) => [edition.id, edition]));
  const salesByEdition = new Map<string, SeriesSale[]>();
  const recentSalesBySeries = new Map<string, number>();
  const recentlyEmptySeries = new Set<string>();
  const recentCutoff = now.getTime() - SEARCH_DAYS * 86_400_000;
  for (const row of history) {
    const series = (byId.get(row.requested_edition_id ?? "")?.series ?? "").trim().toLocaleLowerCase();
    const searchedAt = Date.parse(row.last_started_at);
    if (series && row.last_status === "succeeded" && row.last_result_count === 0
      && Number.isFinite(searchedAt) && searchedAt >= now.getTime() - 7 * 86_400_000) {
      recentlyEmptySeries.add(series);
    }
  }
  for (const sale of sales) {
    const edition = byId.get(sale.edition_id);
    if (!edition) continue;
    const editionSales = salesByEdition.get(edition.id) ?? [];
    editionSales.push(sale);
    salesByEdition.set(edition.id, editionSales);
    const soldAt = Date.parse(`${sale.sold_date ?? ""}T00:00:00Z`);
    const key = (edition.series ?? "").trim().toLocaleLowerCase();
    if (key && Number.isFinite(soldAt) && soldAt >= recentCutoff && soldAt <= now.getTime()) {
      recentSalesBySeries.set(key, (recentSalesBySeries.get(key) ?? 0) + 1);
    }
  }
  const candidates = eligible.map((target, index) => {
    const edition = byId.get(target.editionId)!;
    const coverage = assessEditionCoverage(edition, salesByEdition.get(edition.id) ?? [], 0, now);
    const series = (edition.series ?? "").trim().toLocaleLowerCase();
    return { ...target, index, series, coverage,
      recentSeriesSales: recentSalesBySeries.get(series) ?? 0,
      recentlyEmptySeries: recentlyEmptySeries.has(series),
      neverSearched: !historyByIsbn.has(target.isbn),
      lastFailed: ["failed", "running"].includes(historyByIsbn.get(target.isbn)?.last_status ?? ""),
      volumeOne: Number(edition.volume_number) === 1,
      ebayLanguage: ["english", "japanese"].includes((edition.language ?? "").trim().toLocaleLowerCase()),
    };
  });
  const selected: ScheduledSearchTarget[] = [];
  const seenSeries = new Set<string>();
  const take = (pool: typeof candidates, count: number, reason: ScheduledSearchReason) => {
    for (const candidate of pool) {
      if (selected.length >= limit || count <= 0) break;
      if (!candidate.series || seenSeries.has(candidate.series)) continue;
      seenSeries.add(candidate.series);
      selected.push({ editionId: candidate.editionId, isbn: candidate.isbn, reason });
      count -= 1;
    }
  };

  // Closest to a price first, taking every slot these tiers can fill.
  const tier = (pool: typeof candidates) => pool
    .sort((a, b) => Number(a.lastFailed) - Number(b.lastFailed) || a.index - b.index);
  take(tier(candidates.filter((candidate) => candidate.coverage.state === "stale")), limit, "needs_recent_sale");
  take(tier(candidates.filter((candidate) => candidate.coverage.state === "thin"
    && comparableSalesNeeded(candidate.coverage) === 1)), limit, "one_sale_short");
  take(tier(candidates.filter((candidate) => candidate.coverage.state === "thin"
    && comparableSalesNeeded(candidate.coverage) === 2)), limit, "two_sales_short");
  take(candidates.filter((candidate) => candidate.coverage.comparableSales === 0 && candidate.recentSeriesSales > 0)
    .sort((a, b) => Number(a.recentlyEmptySeries) - Number(b.recentlyEmptySeries)
      || Number(a.lastFailed) - Number(b.lastFailed)
      || b.recentSeriesSales - a.recentSeriesSales || a.index - b.index),
  Math.min(2, Math.max(0, limit - selected.length - 1)), "proven_series");
  take(candidates.filter((candidate) => candidate.recentSeriesSales === 0)
    .sort((a, b) => Number(a.recentlyEmptySeries) - Number(b.recentlyEmptySeries)
      || Number(a.lastFailed) - Number(b.lastFailed)
      || Number(b.ebayLanguage) - Number(a.ebayLanguage)
      || Number(b.volumeOne) - Number(a.volumeOne)
      || Number(b.neverSearched) - Number(a.neverSearched)
      || a.index - b.index),
  1, "exploration");
  take([...candidates].sort((a, b) => Number(a.recentlyEmptySeries) - Number(b.recentlyEmptySeries)
    || Number(a.lastFailed) - Number(b.lastFailed)
    || b.recentSeriesSales - a.recentSeriesSales
    || Number(b.ebayLanguage) - Number(a.ebayLanguage)
    || Number(b.volumeOne) - Number(a.volumeOne)
    || a.index - b.index), limit - selected.length, "coverage_fallback");
  return selected;
}

/** A daily batch should show staff different manga, not six volumes of one series. */
export function distinctSeriesTargets(
  targets: DailySearchTarget[],
  editions: CoverageEdition[],
  limit = MAX_DAILY_BATCH_SERIES,
): DailySearchTarget[] {
  const byId = new Map(editions.map((edition) => [edition.id, edition]));
  const seen = new Set<string>();
  const selected: DailySearchTarget[] = [];
  for (const target of targets) {
    const edition = byId.get(target.editionId);
    const series = (edition?.series ?? "").trim().toLocaleLowerCase();
    if (!series) continue;
    if (seen.has(series)) continue;
    seen.add(series);
    selected.push(target);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function dailySearchTargets(
  editions: CoverageEdition[],
  sales: Array<SeriesSale & { edition_id: string }>,
  outcomes: Array<SalesInboxOutcome & { edition_id: string }>,
  lastSearchedAtByIsbn: Map<string, SearchLogEntry> = new Map(),
  now = new Date(),
): DailySearchTarget[] {
  const salesByEdition = new Map<string, SeriesSale[]>();
  for (const sale of sales) {
    const group = salesByEdition.get(sale.edition_id) ?? [];
    group.push(sale);
    salesByEdition.set(sale.edition_id, group);
  }
  const waitingByEdition = new Map<string, number>();
  const isbnByEdition = new Map(editions.map((edition) => [edition.id, isbnForSearch(edition.isbn_13)]));
  const waitingIsbns = new Set<string>();
  for (const outcome of outcomes) {
    if (!isCurrentSalesFinding(outcome)) continue;
    waitingByEdition.set(outcome.edition_id, (waitingByEdition.get(outcome.edition_id) ?? 0) + 1);
    const isbn = isbnByEdition.get(outcome.edition_id);
    if (isbn) waitingIsbns.add(isbn);
  }

  const seenIsbn = new Set<string>();
  const targets: DailySearchTarget[] = [];
  for (const row of sortCoverage(editions.map((edition) => assessEditionCoverage(
    edition, salesByEdition.get(edition.id) ?? [], waitingByEdition.get(edition.id) ?? 0, now,
  )))) {
    const isbn = isbnForSearch(row.edition.isbn_13);
    if (row.state === "priced" || row.waitingToCheck || !isbn || waitingIsbns.has(isbn) || seenIsbn.has(isbn)) continue;
    if (searchRefreshBlocked(lastSearchedAtByIsbn.get(isbn), now)) continue;
    seenIsbn.add(isbn);
    targets.push({ editionId: row.edition.id, isbn });
  }
  return targets;
}
