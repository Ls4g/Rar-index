"use client";

import { useMemo } from "react";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import PortfolioSummary from "@/components/portfolio/PortfolioSummary";
import PortfolioValueChart, { type PortfolioSnapshotPoint } from "@/components/portfolio/PortfolioValueChart";
import MostValuableHoldings from "@/components/portfolio/MostValuableHoldings";
import ActivityFeed, { type LiveListingActivity, type RecentHoldingActivity, type RecentSaleActivity } from "@/components/portfolio/ActivityFeed";
import type { Holding } from "@/components/portfolio/HoldingCard";
import { computeHoldingMarketValues, computePortfolioSummary, type EditionMarketMetric } from "@/lib/portfolioValuation";
import type { FxRate } from "@/lib/fx";

type OverviewTabProps = {
  holdings: Holding[];
  metricsByEdition: Map<string, EditionMarketMetric[]>;
  rates: FxRate[];
  snapshots: PortfolioSnapshotPoint[];
  onAddClick: () => void;
  recentHoldings: RecentHoldingActivity[];
  recentSales: RecentSaleActivity[];
  liveListings: LiveListingActivity[];
  listingsLoading: boolean;
};

export default function OverviewTab({ holdings, metricsByEdition, rates, snapshots, onAddClick, recentHoldings, recentSales, liveListings, listingsLoading }: OverviewTabProps) {
  const { currency } = useMarketCurrency();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const summary = useMemo(
    () => computePortfolioSummary(holdings, metricsByEdition, rates, currency, today),
    [holdings, metricsByEdition, rates, currency, today],
  );
  const holdingValues = useMemo(
    () => computeHoldingMarketValues(holdings, metricsByEdition, rates, currency, today),
    [holdings, metricsByEdition, rates, currency, today],
  );

  return (
    <div aria-labelledby="portfolio-tab-overview" className="portfolio-overview" id="portfolio-panel-overview" role="tabpanel">
      <PortfolioSummary holdings={holdings} metricsByEdition={metricsByEdition} onAddClick={onAddClick} rates={rates} />

      <div className="portfolio-overview-chart">
        <div className="section-intro">
          <p className="eyebrow">Value over time</p>
          <h2>Portfolio value</h2>
        </div>
        <PortfolioValueChart currency={currency} rangeLabel="All recorded history" snapshots={snapshots} />
      </div>

      <MostValuableHoldings currency={currency} holdings={holdings} marketTotal={summary.marketTotal} values={holdingValues} />

      <ActivityFeed liveListings={liveListings} listingsLoading={listingsLoading} recentHoldings={recentHoldings} recentSales={recentSales} />
    </div>
  );
}
