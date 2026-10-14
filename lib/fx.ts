export const DISPLAY_CURRENCIES = ["GBP", "EUR", "USD"] as const;

export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export type FxRate = {
  rate_date: string;
  currency: string;
  rate_per_eur: number;
  source_name?: string | null;
  source_url?: string | null;
};

export type MarketSale = {
  sold_date: string | null;
  sale_price: number;
  currency: string;
  grading_company: string | null;
  grade_label: string | null;
};

export type ConvertedSale<T extends MarketSale = MarketSale> = T & {
  converted_price: number;
  display_currency: DisplayCurrency;
  fx_rate_date: string | null;
};

// ECB reference rates are published on working days. A short weekend or
// holiday gap is expected; a months-old rate is not a historical conversion.
export const MAX_RATE_AGE_DAYS = 7;

export function comparisonGroup(sale: MarketSale) {
  const grading = sale.grading_company || sale.grade_label
    ? `Graded${sale.grading_company ? ` · ${sale.grading_company}` : ""}${sale.grade_label ? ` ${sale.grade_label}` : ""}`
    : "Raw";

  // Raw condition belongs to the source listing. Graded results are still a
  // distinct market, so only the grading state splits comparable evidence.
  return { grading, key: grading };
}

function rateForDate(currency: string, soldDate: string, rates: FxRate[]) {
  if (currency === "EUR") return { rate: 1, rateDate: soldDate };

  const matchingRates = rates
    .filter((rate) => rate.currency === currency && rate.rate_date <= soldDate)
    .sort((a, b) => b.rate_date.localeCompare(a.rate_date));
  const match = matchingRates[0];
  if (!match) return null;
  const ageDays = (Date.parse(`${soldDate}T00:00:00Z`) - Date.parse(`${match.rate_date}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(ageDays) || ageDays > MAX_RATE_AGE_DAYS) return null;
  return { rate: Number(match.rate_per_eur), rateDate: match.rate_date };
}

/**
 * ECB daily observations are expressed as units of currency per one euro.
 * Converting through EUR keeps the source amount immutable and lets the page
 * show the same historical sale in any selected display currency.
 */
export function convertSale<T extends MarketSale>(sale: T, displayCurrency: DisplayCurrency, rates: FxRate[]): ConvertedSale<T> | null {
  if (!sale.sold_date || !Number.isFinite(sale.sale_price)) return null;
  if (sale.currency === displayCurrency) {
    return { ...sale, converted_price: sale.sale_price, display_currency: displayCurrency, fx_rate_date: null };
  }
  const source = rateForDate(sale.currency, sale.sold_date, rates);
  const target = rateForDate(displayCurrency, sale.sold_date, rates);
  if (!source || !target || source.rate <= 0 || target.rate <= 0) return null;

  return {
    ...sale,
    converted_price: (sale.sale_price / source.rate) * target.rate,
    display_currency: displayCurrency,
    fx_rate_date: source.rateDate < target.rateDate ? source.rateDate : target.rateDate,
  };
}

export function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 2,
  }).format(value);
}

export function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
