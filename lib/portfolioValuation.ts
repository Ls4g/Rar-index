// Pure valuation logic shared between the live client dashboard
// (components/PortfolioClient.tsx and friends) and the server-side snapshot
// route (app/api/portfolio-snapshot/route.ts). No Supabase calls happen
// here -- callers fetch rows, these functions only ever combine and convert
// numbers that already exist, following the exact same rules everywhere:
// only proven first-print sales become market evidence, raw/graded stay
// separate (comparisonGroup in lib/fx.ts), and a value is only combined
// across currencies when convertSale() can find a real historical rate --
// never guessed, never defaulted to zero.
import { comparisonGroup, convertSale, median, type DisplayCurrency, type FxRate } from "./fx.ts";
import { MIN_COMPARABLE_SALES } from "./printClassification.ts";

export type PrintClassification = "first_print_proven" | "known_later_print" | "printing_not_identified";

export type ValuationEdition = {
  id: string;
  printing_of_edition_id: string | null;
  printing_number?: number | null;
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
  known_printing_number: number | null;
  grading_company: string | null;
  grade_label: string | null;
};

export type EditionMarketMetric = {
  edition_id: string;
  currency: string;
  market_value_median: number;
  verified_sale_count: number;
  latest_sale_date: string | null;
  print_classification: PrintClassification;
  known_printing_number: number | null;
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

type SaleFigure = { price: number; currency: string; soldDate: string | null };
type CurrencyMetric = { currency: string; value: number; count: number; latestSoldDate: string | null };

function salePrintingKey(sale: ValuationSale) {
  if (sale.print_classification === "first_print_proven") return "first";
  if (sale.print_classification === "known_later_print" && sale.known_printing_number && sale.known_printing_number > 1) return `later:${sale.known_printing_number}`;
  if (sale.print_classification === "printing_not_identified") return "unknown";
  return null;
}

function holdingPrintingKey(holding: ValuationHolding) {
  const printingNumber = holding.edition?.printing_number ?? null;
  if (printingNumber === 1) return "first";
  if (printingNumber && printingNumber > 1) return `later:${printingNumber}`;
  // The public catalogue normally stores the publication root, which makes
  // no printing claim. Sales whose printing is also unidentified are the
  // exact comparison group for that record; proven first/later sales are not.
  return holding.edition?.printing_of_edition_id ? null : "unknown";
}

function metricClassification(printingKey: string): { printClassification: PrintClassification; knownPrintingNumber: number | null } {
  if (printingKey === "first") return { printClassification: "first_print_proven", knownPrintingNumber: 1 };
  if (printingKey.startsWith("later:")) return { printClassification: "known_later_print", knownPrintingNumber: Number(printingKey.slice(6)) || null };
  return { printClassification: "printing_not_identified", knownPrintingNumber: null };
}

// Computed once per publication, then emitted under every holding's own
// edition_id (a publication and its print-run child can each be held
// separately).
//
// A portfolio value is emitted only from at least three verified completed
// sales in one exact printing + raw/graded + currency group. Holdings do not
// record a grading state, so only raw evidence can value them. A publication
// that makes no printing claim uses only the matching printing-unidentified
// group; selecting a proven first/later group would invent a property of the
// owned copy.
export function computeEditionMetrics(holdings: ValuationHolding[], sales: ValuationSale[], publicationByMember: Map<string, string>): { metrics: EditionMarketMetric[]; otherSaleCounts: Map<string, number> } {
  const groups = new Map<string, SaleFigure[]>();
  for (const sale of sales) {
    const publicationId = publicationByMember.get(sale.edition_id) ?? sale.edition_id;
    const printingKey = salePrintingKey(sale);
    if (!printingKey) continue;
    const grading = comparisonGroup(sale);
    const figure: SaleFigure = { price: sale.sale_price, currency: sale.currency, soldDate: sale.sold_date };
    const key = `${publicationId}::${printingKey}::${grading.key}::${sale.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), figure]);
  }

  const metrics: EditionMarketMetric[] = [];
  const otherSaleCounts = new Map<string, number>();
  for (const holding of holdings) {
    const publicationId = holding.edition?.printing_of_edition_id ?? holding.edition_id;
    const printingKey = holdingPrintingKey(holding);
    const candidates: CurrencyMetric[] = [];
    if (printingKey) {
      const prefix = `${publicationId}::${printingKey}::Raw::`;
      for (const [key, group] of groups) {
        if (!key.startsWith(prefix) || group.length < MIN_COMPARABLE_SALES) continue;
        const value = median(group.map((sale) => sale.price));
        if (value === null) continue;
        const latest = [...group].sort((a, b) => (b.soldDate ?? "").localeCompare(a.soldDate ?? ""))[0];
        candidates.push({ currency: latest.currency, value, count: group.length, latestSoldDate: latest.soldDate });
      }
    }
    // Multiple qualifying currency groups describe alternative evidence for
    // the same copy; adding their medians would count the holding twice. Use
    // the largest group, then the freshest, with a stable currency tie-break.
    const chosen = candidates.sort((a, b) => b.count - a.count || (b.latestSoldDate ?? "").localeCompare(a.latestSoldDate ?? "") || a.currency.localeCompare(b.currency))[0];
    if (chosen && printingKey) {
      const classification = metricClassification(printingKey);
      metrics.push({
        edition_id: holding.edition_id,
        currency: chosen.currency,
        market_value_median: chosen.value,
        verified_sale_count: chosen.count,
        latest_sale_date: chosen.latestSoldDate,
        print_classification: classification.printClassification,
        known_printing_number: classification.knownPrintingNumber,
      });
    }
    const familySaleCount = sales.filter((sale) => (publicationByMember.get(sale.edition_id) ?? sale.edition_id) === publicationId).length;
    otherSaleCounts.set(holding.edition_id, Math.max(0, familySaleCount - (chosen?.count ?? 0)));
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
  // Both in the display currency, so a holding bought in one currency and
  // evidenced in another still compares. null where the amount could not be
  // converted with a real historical rate, or does not exist at all.
  paidValue: number | null;
  gain: number | null;
  gainPercent: number | null;
};

// Per-holding market value in the display currency, for ranking ("Most
// valuable holdings") and for the gain shown on each holding card. null
// marketValue means either no evidence at all, or evidence that exists but
// could not be safely converted -- distinguished via hasExcludedEvidence so
// the UI never shows a holding with real evidence as if it were worth
// nothing.
//
// Gain converts both sides into the display currency through the same
// convertAmount the portfolio totals use, rather than requiring the
// purchase and the evidence to have been in the same currency to begin
// with. A holding bought in GBP against sales evidenced in USD is an
// ordinary case, not an unanswerable one -- and the totals above already
// answered it. Still never estimated: if either side has no real rate for
// its date, the gain stays null instead of being guessed.
export function computeHoldingMarketValues(holdings: ValuationHolding[], metricsByEdition: Map<string, EditionMarketMetric[]>, rates: FxRate[], displayCurrency: DisplayCurrency, today: string): HoldingMarketValue[] {
  return holdings.map((holding) => {
    const paidValue = holding.purchase_price !== null && holding.purchase_currency
      ? convertAmount(holding.purchase_price * holding.quantity, holding.purchase_currency, holding.purchase_date, displayCurrency, rates)
      : null;

    const editionMetrics = metricsByEdition.get(holding.edition_id) ?? [];
    if (!editionMetrics.length) {
      return { holdingId: holding.id, editionId: holding.edition_id, marketValue: null, hasExcludedEvidence: false, paidValue, gain: null, gainPercent: null };
    }

    let total = 0;
    let excluded = false;
    for (const metric of editionMetrics) {
      const amount = metric.market_value_median * holding.quantity;
      const converted = convertAmount(amount, metric.currency, today, displayCurrency, rates);
      if (converted !== null) total += converted;
      else excluded = true;
    }
    const marketValue = excluded ? null : total;
    const gain = marketValue !== null && paidValue !== null ? marketValue - paidValue : null;
    const gainPercent = gain !== null && paidValue ? (gain / paidValue) * 100 : null;
    return { holdingId: holding.id, editionId: holding.edition_id, marketValue, hasExcludedEvidence: excluded, paidValue, gain, gainPercent };
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
