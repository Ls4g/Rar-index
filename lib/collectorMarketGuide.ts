import { median } from "./fx.ts";
import { buildPriceSeries, type SeriesSale } from "./priceSeries.ts";
import { isValidFirstPrintClaim, MIN_COMPARABLE_SALES } from "./printClassification.ts";

export type CollectorMarketSale = SeriesSale & {
  sale_status: string;
  match_status: string;
  source_listing_url: string | null;
  printing_proof_url?: string | null;
  grading_reviewed_at?: string | null;
};

export type CollectorMarketGuide = {
  currency: string;
  median: number;
  comparisonLabel: string;
  saleCount: number;
};

function includesValueAddingExtra(title: string | null | undefined) {
  return /\b(bonus|promo|promotional|signed|autographed|illustration card|trading card)\b/i.test(title ?? "");
}

/** A comparable raw-printing median for public display, never a copy valuation. */
export function collectorMarketGuide(sales: CollectorMarketSale[]): CollectorMarketGuide | null {
  const verified = sales.filter((sale) => sale.sale_status === "confirmed"
    && sale.match_status === "verified_match"
    && Boolean(sale.source_listing_url)
    && Boolean(sale.sold_date)
    // A bonus card or signature makes the sale a bundle, not a clean price for
    // the book on the sample shelf. Keep the source sale; omit only this guide.
    && !includesValueAddingExtra(sale.listing_title)
    && (sale.print_classification !== "first_print_proven" || isValidFirstPrintClaim(sale.printing_proof_url))
    && (sale.print_classification !== "known_later_print" || Number(sale.known_printing_number) >= 2)
    && Number.isFinite(Number(sale.sale_price))
    && Number(sale.sale_price) > 0);

  const candidates: Array<CollectorMarketGuide & { latestDate: string }> = [];
  for (const group of buildPriceSeries(verified)) {
    if (group.graded || group.kind === "printing_unknown") continue;
    const byCurrency = new Map<string, typeof group.sales>();
    for (const sale of group.sales) {
      byCurrency.set(sale.currency, [...(byCurrency.get(sale.currency) ?? []), sale]);
    }
    for (const [currency, comparable] of byCurrency) {
      if (comparable.length < MIN_COMPARABLE_SALES) continue;
      const value = median(comparable.map((sale) => Number(sale.sale_price)));
      if (value === null) continue;
      candidates.push({
        currency,
        median: value,
        comparisonLabel: `Raw ${group.label.toLowerCase()}`,
        saleCount: comparable.length,
        latestDate: comparable.map((sale) => sale.sold_date ?? "").sort().at(-1) ?? "",
      });
    }
  }

  const best = candidates.sort((a, b) => b.saleCount - a.saleCount
    || b.latestDate.localeCompare(a.latestDate)
    || a.comparisonLabel.localeCompare(b.comparisonLabel))[0];
  return best ? {
    currency: best.currency,
    median: best.median,
    comparisonLabel: best.comparisonLabel,
    saleCount: best.saleCount,
  } : null;
}
