import { median } from "./fx.ts";
import { buildPriceSeries, type SeriesSale } from "./priceSeries.ts";
import { MIN_COMPARABLE_SALES } from "./printClassification.ts";

// Does each edition have a current price, and if not, what is in the way?
//
// This exists because the old queue answered the wrong question. It listed
// 2,945 watched listings across eight filter tabs, 636 of them nominally
// "worth checking", and in two and a half months three had ever been opened by
// a person. A list nobody can finish is not a worklist. Meanwhile the thing
// actually being aimed at -- a current price for each of the 235 editions --
// was not on the screen at all.
//
// So the unit here is the edition, not the listing. There are 235 of them, the
// number only goes up, and an edition that already has a price needs no
// further work. That turns an endless queue into a checklist with an end.
//
// Nothing here decides what counts as evidence. It reads verified sales and
// reports on them. The comparable-group split and the three-sale bar are
// buildPriceSeries and MIN_COMPARABLE_SALES, the same rules the charts use, so
// this page cannot quietly hold a laxer opinion about what a price is.

// "Current" means a price RAR could defend today. 90 days is not arbitrary:
// it is the window a sold-listing search can actually refresh, so an edition
// outside it is a different problem (no recent sales exist to find) from one
// inside it (sales exist and have not been collected). Measured on 19 October
// 2026: 53 of the 54 priced editions had a sale inside 90 days, so the window
// separates the two cases rather than condemning everything.
export const PRICE_CURRENT_WITHIN_DAYS = 90;

export type CoverageEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
};

/** Why an edition is or is not carrying a price RAR would stand behind. */
export type CoverageState =
  // Enough comparable sales, recent enough to quote.
  | "priced"
  // Enough comparable sales, but the newest is older than the window.
  | "stale"
  // One or two sales: a figure exists but is not a market price.
  | "thin"
  // No verified sales at all.
  | "none";

export type EditionCoverage = {
  edition: CoverageEdition;
  state: CoverageState;
  /** Median of the strongest comparable group, in that group's own currency. */
  medianPrice: number | null;
  currency: string | null;
  /** Sales behind the median -- one comparable group, one currency. */
  comparableSales: number;
  /** Every verified sale for the edition, including other groups. */
  totalSales: number;
  latestSaleDate: string | null;
  /** Which comparable group the median came from, for display. */
  groupLabel: string | null;
  /** Listings already queued for this edition that a person has not resolved. */
  waitingToCheck: number;
};

function daysBetween(from: string, to: Date) {
  const timestamp = Date.parse(`${from}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return (to.getTime() - timestamp) / 86_400_000;
}

/**
 * One edition's price position.
 *
 * `sales` must already be the verified sales for this edition and nothing
 * else: this decides how they group and whether they are current, never
 * whether they were allowed to count.
 */
export function assessEditionCoverage(
  edition: CoverageEdition,
  sales: SeriesSale[],
  waitingToCheck = 0,
  now = new Date(),
): EditionCoverage {
  const base: EditionCoverage = {
    edition,
    state: "none",
    medianPrice: null,
    currency: null,
    comparableSales: 0,
    totalSales: sales.length,
    latestSaleDate: null,
    groupLabel: null,
    waitingToCheck,
  };
  if (!sales.length) return base;

  // The same split the charts draw: a first printing and a fifth printing are
  // different markets and must never share a median.
  const series = buildPriceSeries(sales, MIN_COMPARABLE_SALES);
  const strongest = [...series].sort((left, right) => right.sales.length - left.sales.length)[0];
  if (!strongest) return base;

  // A median across currencies would be meaningless, so the strongest group's
  // most-supported currency is the one quoted. Converting to one display
  // currency is the viewer's choice and belongs on the page, not in the figure.
  const byCurrency = new Map<string, SeriesSale[]>();
  for (const sale of strongest.sales) {
    const group = byCurrency.get(sale.currency);
    if (group) group.push(sale);
    else byCurrency.set(sale.currency, [sale]);
  }
  const [currency, group] = [...byCurrency.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];

  const latestSaleDate = group
    .map((sale) => sale.sold_date)
    .filter((date): date is string => Boolean(date))
    .sort()
    .at(-1) ?? null;

  const enough = group.length >= MIN_COMPARABLE_SALES;
  const current = latestSaleDate !== null && daysBetween(latestSaleDate, now) <= PRICE_CURRENT_WITHIN_DAYS;

  return {
    ...base,
    state: enough ? (current ? "priced" : "stale") : "thin",
    medianPrice: median(group.map((sale) => sale.sale_price)),
    currency,
    comparableSales: group.length,
    latestSaleDate,
    groupLabel: strongest.label,
  };
}

export type CoverageSummary = {
  total: number;
  priced: number;
  stale: number;
  thin: number;
  none: number;
  /** Listings queued across every edition that nobody has resolved yet. */
  waitingToCheck: number;
};

export function coverageSummary(rows: EditionCoverage[]): CoverageSummary {
  const summary: CoverageSummary = { total: rows.length, priced: 0, stale: 0, thin: 0, none: 0, waitingToCheck: 0 };
  for (const row of rows) {
    summary[row.state] += 1;
    summary.waitingToCheck += row.waitingToCheck;
  }
  return summary;
}

// Most of the work first. An edition with listings already waiting is one
// decision away from a price, so it outranks one that needs a search run
// before anything can happen at all; a finished edition sinks to the bottom.
const STATE_ORDER: Record<CoverageState, number> = { thin: 0, none: 1, stale: 2, priced: 3 };

export function sortCoverage(rows: EditionCoverage[]) {
  return [...rows].sort((left, right) => {
    if (left.state !== right.state) return STATE_ORDER[left.state] - STATE_ORDER[right.state];
    if (left.waitingToCheck !== right.waitingToCheck) return right.waitingToCheck - left.waitingToCheck;
    // A tiebreak that cannot shift between requests, so paging stays stable.
    const label = `${left.edition.series ?? ""}`.localeCompare(`${right.edition.series ?? ""}`);
    if (label) return label;
    const volume = Number(left.edition.volume_number ?? 0) - Number(right.edition.volume_number ?? 0);
    if (volume) return volume;
    return left.edition.id.localeCompare(right.edition.id);
  });
}

export const COVERAGE_STATE_LABEL: Record<CoverageState, string> = {
  priced: "Priced",
  stale: "Out of date",
  thin: "Not enough sales",
  none: "No sales yet",
};

export function coverageStateHelp(row: EditionCoverage): string {
  switch (row.state) {
    case "priced":
      return `${row.comparableSales} comparable sales, newest ${row.latestSaleDate}.`;
    case "stale":
      return `${row.comparableSales} comparable sales, but the newest is ${row.latestSaleDate}. Run a search to refresh it.`;
    case "thin":
      return `${row.comparableSales} of ${MIN_COMPARABLE_SALES} sales needed. ${row.waitingToCheck ? `${row.waitingToCheck} listing${row.waitingToCheck === 1 ? "" : "s"} waiting for you.` : "Run a search to find more."}`;
    case "none":
      return row.waitingToCheck
        ? `${row.waitingToCheck} listing${row.waitingToCheck === 1 ? "" : "s"} waiting for you.`
        : "Run a search to find sales.";
  }
}
