"use client";

import { useMemo, useState } from "react";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import ChartRangeSelector from "@/components/ChartRangeSelector";
import { chartRange, chartRangeCutoff, type ChartRangeKey } from "@/lib/chartRanges";
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
  const [range, setRange] = useState<ChartRangeKey>("MAX");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const summary = useMemo(
    () => computePortfolioSummary(holdings, metricsByEdition, rates, currency, today),
    [holdings, metricsByEdition, rates, currency, today],
  );
  const holdingValues = useMemo(
    () => computeHoldingMarketValues(holdings, metricsByEdition, rates, currency, today),
    [holdings, metricsByEdition, rates, currency, today],
  );
  const chartSnapshots = useMemo(() => {
    const cutoff = chartRangeCutoff(range);
    if (cutoff === null) return snapshots;
    return snapshots.filter((snapshot) => new Date(snapshot.snapshot_at).getTime() >= cutoff);
  }, [snapshots, range]);

  return (
    <div aria-labelledby="portfolio-tab-overview" className="portfolio-overview" id="portfolio-panel-overview" role="tabpanel">
      <PortfolioSummary holdings={holdings} metricsByEdition={metricsByEdition} onAddClick={onAddClick} rates={rates} />

      <div className="portfolio-overview-chart">
        <div className="section-intro portfolio-overview-chart-head">
          <div>
            <p className="eyebrow">Value over time</p>
            <h2>Portfolio value</h2>
          </div>
          <ChartRangeSelector label="Portfolio value time range" onChange={setRange} value={range} />
        </div>
        {/* Same fallback rule as the Performance tab: a window with nothing
            in it shows the full history rather than the "tracking starts
            today" state, which would be untrue of a portfolio whose history
            simply sits outside the chosen window. */}
        <PortfolioValueChart currency={currency} rangePhrase={chartRange(chartSnapshots.length ? range : "MAX").phrase} snapshots={chartSnapshots.length ? chartSnapshots : snapshots} />
      </div>

      <MostValuableHoldings currency={currency} holdings={holdings} marketTotal={summary.marketTotal} values={holdingValues} />

      <ActivityFeed liveListings={liveListings} listingsLoading={listingsLoading} recentHoldings={recentHoldings} recentSales={recentSales} />
    </div>
  );
}
