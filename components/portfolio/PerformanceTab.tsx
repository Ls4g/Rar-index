"use client";

import { useMemo, useState } from "react";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import ChartRangeSelector from "@/components/ChartRangeSelector";
import PortfolioValueChart, { type PortfolioSnapshotPoint } from "@/components/portfolio/PortfolioValueChart";
import { chartRange, chartRangeCutoff, type ChartRangeKey } from "@/lib/chartRanges";

type PerformanceTabProps = {
  snapshots: PortfolioSnapshotPoint[];
};

// Read-only: every snapshot here was recorded automatically -- when a
// holding is added, edited, or removed, when verified evidence changes for
// an edition a portfolio holds, and once daily for everyone else. There is
// no manual "take a snapshot" step to show or trigger from this tab.
export default function PerformanceTab({ snapshots }: PerformanceTabProps) {
  const { currency } = useMarketCurrency();
  const [range, setRange] = useState<ChartRangeKey>("3M");

  const meta = chartRange(range);
  const filtered = useMemo(() => {
    const cutoff = chartRangeCutoff(range);
    if (cutoff === null) return snapshots;
    return snapshots.filter((snapshot) => new Date(snapshot.snapshot_at).getTime() >= cutoff);
  }, [snapshots, range]);

  // A range with no snapshots in it (but real history elsewhere) falls back
  // to showing everything recorded rather than firing the "tracking starts
  // today" empty state, which would misrepresent a portfolio that already
  // has history just outside the selected window.
  const usingFallback = snapshots.length > 0 && filtered.length === 0;
  const chartSnapshots = usingFallback ? snapshots : filtered;
  // A window that turned out to hold every snapshot there is describes
  // itself as the full history, not as the window. Otherwise a portfolio
  // whose whole history is one evening reads "the last year" on 1Y.
  const showingEverything = chartSnapshots.length === snapshots.length;
  const rangePhrase = chartRange(showingEverything ? "MAX" : range).phrase;

  return (
    <section aria-labelledby="portfolio-tab-performance" className="portfolio-performance" id="portfolio-panel-performance" role="tabpanel">
      <div className="section-intro portfolio-performance-head">
        <div>
          <p className="eyebrow">Portfolio history</p>
          <h2>Performance</h2>
        </div>
        <ChartRangeSelector label="Performance time range" onChange={setRange} value={range} />
      </div>

      <p className="portfolio-performance-explainer">
        Built automatically from your own recorded snapshots — never estimated, backdated, or drawn from active Scout listings. A new snapshot is recorded whenever a holding changes or verified evidence changes, and once daily otherwise. Gain or loss only appears when purchase price and evidence value are both fully comparable in one currency.
      </p>
      {usingFallback ? <p className="portfolio-performance-note" role="status">No snapshots in {meta.phrase} — showing your full history instead.</p> : null}

      <PortfolioValueChart currency={currency} rangePhrase={rangePhrase} snapshots={chartSnapshots} />
    </section>
  );
}
