"use client";

import { useMemo } from "react";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import { HomeMarketCurrencyControl } from "@/components/HomeMarketDisplay";
import { formatPrice, type FxRate } from "@/lib/fx";
import { computePortfolioSummary, type EditionMarketMetric, type ValuationHolding } from "@/lib/portfolioValuation";

export type SummaryHolding = ValuationHolding;
export type SummaryMetric = EditionMarketMetric;

type PortfolioSummaryProps = {
  holdings: SummaryHolding[];
  metricsByEdition: Map<string, SummaryMetric[]>;
  rates: FxRate[];
  onAddClick: () => void;
};

export default function PortfolioSummary({ holdings, metricsByEdition, rates, onAddClick }: PortfolioSummaryProps) {
  const { currency } = useMarketCurrency();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const summary = useMemo(
    () => computePortfolioSummary(holdings, metricsByEdition, rates, currency, today),
    [holdings, metricsByEdition, rates, currency, today],
  );

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
              {/* Named explicitly, because this is not a movement over a
                  window like the chart's figure -- it is today's value set
                  against what was paid, whenever that was. */}
              <small>{summary.gainLossPercent !== null ? `${summary.gainLossPercent >= 0 ? "+" : ""}${summary.gainLossPercent.toFixed(1)}% against what you paid` : "Compared with what you paid"}</small>
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
