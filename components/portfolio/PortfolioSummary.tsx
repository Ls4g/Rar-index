"use client";

import { useMemo } from "react";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import { HomeMarketCurrencyControl } from "@/components/HomeMarketDisplay";
import { convertSale, formatPrice, type DisplayCurrency, type FxRate } from "@/lib/fx";

export type SummaryHolding = {
  id: string;
  edition_id: string;
  quantity: number;
  purchase_price: number | null;
  purchase_currency: string | null;
  purchase_date: string | null;
};

export type SummaryMetric = { edition_id: string; currency: string; market_value_median: number; verified_sale_count: number; latest_sale_date: string | null };

type PortfolioSummaryProps = {
  holdings: SummaryHolding[];
  metricsByEdition: Map<string, SummaryMetric[]>;
  rates: FxRate[];
  onAddClick: () => void;
};

// Converts one amount into the display currency only when it's safe to:
// same currency needs no rate lookup at all (and so can never be wrongly
// excluded just because exchange_rates happens to be missing that day), and
// a genuine cross-currency conversion only happens with a real date to look
// up a real historical rate for. No date, or no rate for that date, means
// the amount is reported separately instead of guessed.
function convertAmount(amount: number, sourceCurrency: string, dateForRate: string | null, displayCurrency: DisplayCurrency, rates: FxRate[]) {
  if (sourceCurrency === displayCurrency) return amount;
  if (!dateForRate) return null;
  const converted = convertSale({ sale_price: amount, currency: sourceCurrency, sold_date: dateForRate, grading_company: null, grade_label: null }, displayCurrency, rates);
  return converted ? converted.converted_price : null;
}

export default function PortfolioSummary({ holdings, metricsByEdition, rates, onAddClick }: PortfolioSummaryProps) {
  const { currency } = useMarketCurrency();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const summary = useMemo(() => {
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
        const converted = convertAmount(amount, holding.purchase_currency, holding.purchase_date, currency, rates);
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
          const converted = convertAmount(amount, metric.currency, today, currency, rates);
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

    return {
      paidTotal, hasAnyPurchasePrice, paidExcludedCount, paidExcludedByCurrency,
      marketTotal, valuedCount, marketExcludedCount, marketExcludedByCurrency,
      unvaluedCount, gainLoss, gainLossPercent,
    };
  }, [holdings, metricsByEdition, rates, currency, today]);

  const gainLossTone = summary.gainLoss === null ? "is-neutral" : summary.gainLoss > 0 ? "is-positive" : summary.gainLoss < 0 ? "is-negative" : "is-neutral";

  return (
    <section className="portfolio-dashboard">
      <div className="portfolio-dashboard-head">
        <div>
          <p className="eyebrow">Your private collection</p>
          <h1>Portfolio</h1>
        </div>
        <div className="portfolio-dashboard-actions">
          <HomeMarketCurrencyControl />
          <button className="portfolio-add-cta" onClick={onAddClick} type="button">+ Add to portfolio</button>
        </div>
      </div>

      <div className="portfolio-stat-grid">
        <div className="portfolio-stat-card">
          <span>Total paid</span>
          {summary.hasAnyPurchasePrice ? <strong>{formatPrice(summary.paidTotal, currency)}</strong> : <strong className="is-muted">Add purchase price</strong>}
          {summary.paidExcludedCount ? <small>+ {[...summary.paidExcludedByCurrency.entries()].map(([code, value]) => formatPrice(value, code)).join(", ")} not included — no exchange rate for that date</small> : null}
        </div>
        <div className="portfolio-stat-card">
          <span>RAR market value</span>
          {summary.valuedCount ? <strong>{formatPrice(summary.marketTotal, currency)}</strong> : <strong className="is-muted">Still being researched</strong>}
          {summary.marketExcludedCount ? <small>+ {[...summary.marketExcludedByCurrency.entries()].map(([code, value]) => formatPrice(value, code)).join(", ")} not included — no exchange rate available</small> : null}
        </div>
        <div className={`portfolio-stat-card portfolio-gain-card ${gainLossTone}`}>
          <span>Gain / loss</span>
          {summary.gainLoss !== null ? (
            <>
              <strong>{summary.gainLoss >= 0 ? "+" : ""}{formatPrice(summary.gainLoss, currency)}</strong>
              <small>{summary.gainLossPercent !== null ? `${summary.gainLossPercent >= 0 ? "+" : ""}${summary.gainLossPercent.toFixed(1)}%` : null}</small>
            </>
          ) : (
            <strong className="is-muted">{summary.hasAnyPurchasePrice && summary.valuedCount ? "Currencies not fully comparable" : summary.hasAnyPurchasePrice ? "Market evidence still being researched" : "Add purchase price to compare"}</strong>
          )}
        </div>
        <div className="portfolio-stat-card">
          <span>Editions tracked</span>
          <strong>{holdings.length}</strong>
        </div>
        <div className="portfolio-stat-card">
          <span>Needs more evidence</span>
          <strong className={summary.unvaluedCount ? "" : "is-muted"}>{summary.unvaluedCount}</strong>
          <small>Holdings without a verified comparable sale yet</small>
        </div>
      </div>
    </section>
  );
}
