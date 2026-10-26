import { assessEditionCoverage, sortCoverage, type CoverageEdition } from "./editionPriceCoverage.ts";
import { isbnForSearch } from "./apifySoldSearch.ts";
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
