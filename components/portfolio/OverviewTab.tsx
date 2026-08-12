"use client";

import { useMemo, useState } from "react";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import ChartRangeSelector from "@/components/ChartRangeSelector";
import { chartRange, chartRangeCutoff, type ChartRangeKey } from "@/lib/chartRanges";
import PortfolioSummary from "@/components/portfolio/PortfolioSummary";
import PortfolioValueChart, { type PortfolioSnapshotPoint } from "@/components/portfolio/PortfolioValueChart";
import MostValuableHoldings from "@/components/portfolio/MostValuableHoldings";
import SeriesProgress from "@/components/portfolio/SeriesProgress";
import type { CatalogueVolume } from "@/lib/seriesCompletion";
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
  seriesCatalogue: CatalogueVolume[];
};

export default function OverviewTab({ holdings, metricsByEdition, rates, snapshots, onAddClick, recentHoldings, recentSales, liveListings, listingsLoading, seriesCatalogue }: OverviewTabProps) {
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
  const shownSnapshots = useMemo(() => {
    const cutoff = chartRangeCutoff(range);
    if (cutoff === null) return snapshots;
    const withinRange = snapshots.filter((snapshot) => new Date(snapshot.snapshot_at).getTime() >= cutoff);
    return withinRange.length ? withinRange : snapshots;
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
        {/* Two rules, both about never letting the button describe the data.
            A window with nothing in it shows the full history rather than
            the "tracking starts today" state; and a window that turned out
            to contain everything is labelled as the full history too, so
            pressing 1M on a portfolio three hours old does not claim a
            month of it. */}
        <PortfolioValueChart currency={currency} rangePhrase={chartRange(shownSnapshots.length === snapshots.length ? "MAX" : range).phrase} snapshots={shownSnapshots} />
      </div>

      <SeriesProgress catalogue={seriesCatalogue} ownedEditionIds={holdings.map((holding) => holding.edition_id)} />

      <MostValuableHoldings currency={currency} holdings={holdings} marketTotal={summary.marketTotal} values={holdingValues} />

      <ActivityFeed liveListings={liveListings} listingsLoading={listingsLoading} recentHoldings={recentHoldings} recentSales={recentSales} />
    </div>
  );
}
