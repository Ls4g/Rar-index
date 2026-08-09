// Pure valuation logic shared between the live client dashboard
// (components/PortfolioClient.tsx and friends) and the server-side snapshot
// route (app/api/portfolio-snapshot/route.ts). No Supabase calls happen
// here -- callers fetch rows, these functions only ever combine and convert
// numbers that already exist, following the exact same rules everywhere:
// only proven first-print sales become market evidence, raw/graded stay
// separate (comparisonGroup in lib/fx.ts), and a value is only combined
// across currencies when convertSale() can find a real historical rate --
// never guessed, never defaulted to zero.
import { convertSale, median, type DisplayCurrency, type FxRate } from "@/lib/fx";

export type PrintClassification = "first_print_proven" | "known_later_print" | "printing_not_identified";

export type ValuationEdition = {
  id: string;
  printing_of_edition_id: string | null;
};

export type ValuationHolding = {
  id: string;
  edition_id: string;
  quantity: number;
  purchase_price: number | null;
  purchase_currency: string | null;
  purchase_date: string | null;
  edition: ValuationEdition | null;
};

export type ValuationSale = {
  edition_id: string;
  sale_price: number;
  currency: string;
  sold_date: string | null;
  print_classification: PrintClassification;
};

export type EditionMarketMetric = {
  edition_id: string;
  currency: string;
  market_value_median: number;
  verified_sale_count: number;
  latest_sale_date: string | null;
};

export type PublicationFamily = {
  publicationByMember: Map<string, string>;
  publicationIds: string[];
};

// A holding can point at a publication or (for older holdings added before
// print-run tracking existed) directly at one of its proven print-run
// children -- resolve both directions so evidence is never missed just
// because it lives on the sibling record.
export function resolvePublicationFamily(holdings: ValuationHolding[], children: Array<{ id: string; printing_of_edition_id: string | null }>): PublicationFamily {
  const publicationIds = [...new Set(holdings.map((holding) => holding.edition?.printing_of_edition_id ?? holding.edition_id))];
  const publicationByMember = new Map<string, string>();
  for (const holding of holdings) {
    const publicationId = holding.edition?.printing_of_edition_id ?? holding.edition_id;
    publicationByMember.set(holding.edition_id, publicationId);
    publicationByMember.set(publicationId, publicationId);
  }
  for (const child of children) {
    if (child.printing_of_edition_id) publicationByMember.set(child.id, child.printing_of_edition_id);
  }
  return { publicationByMember, publicationIds };
}

export function familyIdsFor(holdings: ValuationHolding[], publicationIds: string[], children: Array<{ id: string }>) {
  return [...new Set([...holdings.map((holding) => holding.edition_id), ...publicationIds, ...children.map((child) => child.id)])];
}

// Computed once per publication, then emitted under every holding's own
// edition_id (a publication and its print-run child can each be held
// separately, and both must see the same proven evidence).
export function computeEditionMetrics(holdings: ValuationHolding[], sales: ValuationSale[], publicationByMember: Map<string, string>): { metrics: EditionMarketMetric[]; otherSaleCounts: Map<string, number> } {
  const provenByPublication = new Map<string, Array<{ price: number; currency: string; soldDate: string | null }>>();
  const otherCountByPublication = new Map<string, number>();
  for (const sale of sales) {
    const publicationId = publicationByMember.get(sale.edition_id) ?? sale.edition_id;
    if (sale.print_classification === "first_print_proven") {
      const list = provenByPublication.get(publicationId) ?? [];
      list.push({ price: sale.sale_price, currency: sale.currency, soldDate: sale.sold_date });
      provenByPublication.set(publicationId, list);
    } else {
      otherCountByPublication.set(publicationId, (otherCountByPublication.get(publicationId) ?? 0) + 1);
    }
  }

  const metricsByPublication = new Map<string, Array<{ currency: string; value: number; count: number; latestSoldDate: string | null }>>();
  for (const [publicationId, publicationSales] of provenByPublication) {
    const byCurrency = new Map<string, typeof publicationSales>();
    for (const sale of publicationSales) byCurrency.set(sale.currency, [...(byCurrency.get(sale.currency) ?? []), sale]);
    const perCurrency: Array<{ currency: string; value: number; count: number; latestSoldDate: string | null }> = [];
    for (const [currency, group] of byCurrency) {
      const value = median(group.map((sale) => sale.price));
      if (value === null) continue;
      const latest = [...group].sort((a, b) => (b.soldDate ?? "").localeCompare(a.soldDate ?? ""))[0];
      perCurrency.push({ currency, value, count: group.length, latestSoldDate: latest.soldDate });
    }
    metricsByPublication.set(publicationId, perCurrency);
  }

  const metrics: EditionMarketMetric[] = [];
  const otherSaleCounts = new Map<string, number>();
  for (const holding of holdings) {
    const publicationId = holding.edition?.printing_of_edition_id ?? holding.edition_id;
    for (const entry of metricsByPublication.get(publicationId) ?? []) {
      metrics.push({ edition_id: holding.edition_id, currency: entry.currency, market_value_median: entry.value, verified_sale_count: entry.count, latest_sale_date: entry.latestSoldDate });
    }
    otherSaleCounts.set(holding.edition_id, otherCountByPublication.get(publicationId) ?? 0);
  }
  return { metrics, otherSaleCounts };
}

export function groupMetricsByEdition(metrics: EditionMarketMetric[]): Map<string, EditionMarketMetric[]> {
  const mapped = new Map<string, EditionMarketMetric[]>();
  for (const metric of metrics) mapped.set(metric.edition_id, [...(mapped.get(metric.edition_id) ?? []), metric]);
  return mapped;
}

// Converts one amount into the display currency only when it's safe to:
// same currency needs no rate lookup at all (and so can never be wrongly
// excluded just because exchange_rates happens to be missing that day), and
// a genuine cross-currency conversion only happens with a real date to look
// up a real historical rate for. No date, or no rate for that date, means
// the amount is reported separately instead of guessed.
export function convertAmount(amount: number, sourceCurrency: string, dateForRate: string | null, displayCurrency: DisplayCurrency, rates: FxRate[]): number | null {
  if (sourceCurrency === displayCurrency) return amount;
  if (!dateForRate) return null;
  const converted = convertSale({ sale_price: amount, currency: sourceCurrency, sold_date: dateForRate, grading_company: null, grade_label: null }, displayCurrency, rates);
  return converted ? converted.converted_price : null;
}

export type PortfolioValueSummary = {
  paidTotal: number;
  hasAnyPurchasePrice: boolean;
  paidExcludedCount: number;
  paidExcludedByCurrency: Map<string, number>;
  marketTotal: number;
  valuedCount: number;
  marketExcludedCount: number;
  marketExcludedByCurrency: Map<string, number>;
  unvaluedCount: number;
  gainLoss: number | null;
  gainLossPercent: number | null;
};

// The single "can we honestly combine these numbers" rule, used identically
// by the live dashboard and every stored snapshot: gain/loss only exists
// when every holding's paid amount AND every holding's market evidence
// converted cleanly into one currency -- never a partial estimate.
export function computePortfolioSummary(holdings: ValuationHolding[], metricsByEdition: Map<string, EditionMarketMetric[]>, rates: FxRate[], displayCurrency: DisplayCurrency, today: string): PortfolioValueSummary {
  let paidTotal = 0;
  let paidExcludedCount = 0;
  const paidExcludedByCurrency = new Map<string, number>();
  let marketTotal = 0;
  let marketExcludedCount = 0;
  const marketExcludedByCurrency = new Map<string, number>();
  let valuedCount = 0;
  let hasAnyPurchasePrice = false;

  for (const holding of holdings) {
    if (holding.purchase_price !== null && holding.purchase_currency) {
      hasAnyPurchasePrice = true;
      const amount = holding.purchase_price * holding.quantity;
      const converted = convertAmount(amount, holding.purchase_currency, holding.purchase_date, displayCurrency, rates);
      if (converted !== null) paidTotal += converted;
      else {
        paidExcludedCount += 1;
        paidExcludedByCurrency.set(holding.purchase_currency, (paidExcludedByCurrency.get(holding.purchase_currency) ?? 0) + amount);
      }
    }

    const editionMetrics = metricsByEdition.get(holding.edition_id) ?? [];
    if (editionMetrics.length) {
      valuedCount += 1;
      for (const metric of editionMetrics) {
        const amount = metric.market_value_median * holding.quantity;
        const converted = convertAmount(amount, metric.currency, today, displayCurrency, rates);
        if (converted !== null) marketTotal += converted;
        else {
          marketExcludedCount += 1;
          marketExcludedByCurrency.set(metric.currency, (marketExcludedByCurrency.get(metric.currency) ?? 0) + amount);
        }
      }
    }
  }

  const unvaluedCount = holdings.length - valuedCount;
  const canCompareGainLoss = hasAnyPurchasePrice && paidTotal > 0 && valuedCount > 0 && paidExcludedCount === 0 && marketExcludedCount === 0;
  const gainLoss = canCompareGainLoss ? marketTotal - paidTotal : null;
  const gainLossPercent = gainLoss !== null && paidTotal > 0 ? (gainLoss / paidTotal) * 100 : null;

  return { paidTotal, hasAnyPurchasePrice, paidExcludedCount, paidExcludedByCurrency, marketTotal, valuedCount, marketExcludedCount, marketExcludedByCurrency, unvaluedCount, gainLoss, gainLossPercent };
}

export type HoldingMarketValue = {
  holdingId: string;
  editionId: string;
  marketValue: number | null;
  hasExcludedEvidence: boolean;
};

// Per-holding market value in the display currency, for ranking ("Most
// valuable holdings"). null means either no evidence at all, or evidence
// that exists but could not be safely converted -- distinguished via
// hasExcludedEvidence so the UI never shows a holding with real evidence as
// if it were worth nothing.
export function computeHoldingMarketValues(holdings: ValuationHolding[], metricsByEdition: Map<string, EditionMarketMetric[]>, rates: FxRate[], displayCurrency: DisplayCurrency, today: string): HoldingMarketValue[] {
  return holdings.map((holding) => {
    const editionMetrics = metricsByEdition.get(holding.edition_id) ?? [];
    if (!editionMetrics.length) return { holdingId: holding.id, editionId: holding.edition_id, marketValue: null, hasExcludedEvidence: false };
    let total = 0;
    let excluded = false;
    for (const metric of editionMetrics) {
      const amount = metric.market_value_median * holding.quantity;
      const converted = convertAmount(amount, metric.currency, today, displayCurrency, rates);
      if (converted !== null) total += converted;
      else excluded = true;
    }
    return { holdingId: holding.id, editionId: holding.edition_id, marketValue: excluded ? null : total, hasExcludedEvidence: excluded };
  });
}

export type SnapshotPayload = {
  display_currency: DisplayCurrency;
  total_paid: number | null;
  paid_excluded_totals: Record<string, number>;
  total_evidence_value: number | null;
  evidence_excluded_totals: Record<string, number>;
  gain_loss_amount: number | null;
  gain_loss_percent: number | null;
  holdings_total_count: number;
  holdings_valued_count: number;
  holdings_unvalued_count: number;
};

// Shapes a computed summary into exactly the columns portfolio_snapshots
// expects. total_paid/total_evidence_value stay null (never 0) when there
// is nothing to report yet, matching the migration's column comments.
export function buildSnapshotPayload(holdingsCount: number, summary: PortfolioValueSummary, displayCurrency: DisplayCurrency): SnapshotPayload {
  return {
    display_currency: displayCurrency,
    total_paid: summary.hasAnyPurchasePrice ? summary.paidTotal : null,
    paid_excluded_totals: Object.fromEntries(summary.paidExcludedByCurrency),
    total_evidence_value: summary.valuedCount > 0 ? summary.marketTotal : null,
    evidence_excluded_totals: Object.fromEntries(summary.marketExcludedByCurrency),
    gain_loss_amount: summary.gainLoss,
    gain_loss_percent: summary.gainLossPercent,
    holdings_total_count: holdingsCount,
    holdings_valued_count: summary.valuedCount,
    holdings_unvalued_count: summary.unvaluedCount,
  };
}
