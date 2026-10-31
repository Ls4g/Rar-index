import { assessEditionCoverage, sortCoverage, type CoverageEdition } from "./editionPriceCoverage.ts";
import { isbnForSearch, MAX_DAILY_BATCH_SERIES, SEARCH_DAYS } from "./apifySoldSearch.ts";
import { isCurrentSalesFinding, type SalesInboxOutcome } from "./salesInbox.ts";
import type { SeriesSale } from "./priceSeries.ts";

export const MAX_DAILY_APIFY_SEARCHES = 10;
export const SCHEDULED_ISBN_REFRESH_DAYS = 30;

export function configuredDailySearchLimit(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return 0;
  const count = Number(value);
  return count >= 1 && count <= MAX_DAILY_APIFY_SEARCHES ? count : 0;
}

export type DailySearchTarget = { editionId: string; isbn: string };
export type ScheduledSearchReason = "near_chart" | "proven_series" | "exploration" | "coverage_fallback";
export type ScheduledSearchTarget = DailySearchTarget & { reason: ScheduledSearchReason };
export type ScheduledSearchHistory = {
  isbn_13: string;
  requested_edition_id: string | null;
  last_started_at: string;
  last_status: string;
  last_result_count: number | null;
};

/**
 * Spend the fixed daily batch on a mix of almost-chartable editions, series
 * with recent verified sales, and one unproven series. These are search
 * priorities only: a series sale never establishes a sale for another edition.
 */
export function selectScheduledSearchTargets(
  editions: CoverageEdition[],
  sales: Array<SeriesSale & { edition_id: string }>,
  outcomes: Array<SalesInboxOutcome & { edition_id: string }>,
  history: ScheduledSearchHistory[] = [],
  now = new Date(),
  limit = MAX_DAILY_BATCH_SERIES,
): ScheduledSearchTarget[] {
  const lastSearchedAtByIsbn = new Map(history.map((row) => [row.isbn_13, row.last_started_at]));
  const eligible = dailySearchTargets(editions, sales, outcomes, lastSearchedAtByIsbn, now);
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
      neverSearched: !lastSearchedAtByIsbn.has(target.isbn),
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

  take(candidates.filter((candidate) => candidate.coverage.state === "thin" && candidate.coverage.comparableSales > 0)
    .sort((a, b) => b.coverage.comparableSales - a.coverage.comparableSales || a.index - b.index),
  Math.min(3, limit > 1 ? limit - 1 : limit), "near_chart");
  take(candidates.filter((candidate) => candidate.coverage.comparableSales === 0 && candidate.recentSeriesSales > 0)
    .sort((a, b) => Number(a.recentlyEmptySeries) - Number(b.recentlyEmptySeries)
      || b.recentSeriesSales - a.recentSeriesSales || a.index - b.index),
  Math.min(2, Math.max(0, limit - selected.length - 1)), "proven_series");
  take(candidates.filter((candidate) => candidate.recentSeriesSales === 0)
    .sort((a, b) => Number(a.recentlyEmptySeries) - Number(b.recentlyEmptySeries)
      || Number(b.ebayLanguage) - Number(a.ebayLanguage)
      || Number(b.volumeOne) - Number(a.volumeOne)
      || Number(b.neverSearched) - Number(a.neverSearched)
      || a.index - b.index),
  1, "exploration");
  take([...candidates].sort((a, b) => Number(a.recentlyEmptySeries) - Number(b.recentlyEmptySeries)
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
  lastSearchedAtByIsbn = new Map<string, string>(),
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
    const lastSearched = Date.parse(lastSearchedAtByIsbn.get(isbn) ?? "");
    if (Number.isFinite(lastSearched) && now.getTime() - lastSearched < SCHEDULED_ISBN_REFRESH_DAYS * 86_400_000) continue;
    seenIsbn.add(isbn);
    targets.push({ editionId: row.edition.id, isbn });
  }
  return targets;
}
