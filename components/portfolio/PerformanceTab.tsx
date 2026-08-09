"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import PortfolioValueChart, { type PortfolioSnapshotPoint } from "@/components/portfolio/PortfolioValueChart";

const RANGES = [
  { key: "1M", label: "1 month", days: 30 },
  { key: "3M", label: "3 months", days: 90 },
  { key: "6M", label: "6 months", days: 182 },
  { key: "MAX", label: "All time", days: null as number | null },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

type PerformanceTabProps = {
  snapshots: PortfolioSnapshotPoint[];
  onSnapshotTaken: () => void | Promise<void>;
};

export default function PerformanceTab({ snapshots, onSnapshotTaken }: PerformanceTabProps) {
  const { currency } = useMarketCurrency();
  const [range, setRange] = useState<RangeKey>("3M");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const rangeMeta = RANGES.find((entry) => entry.key === range)!;
  const filtered = useMemo(() => {
    if (rangeMeta.days === null) return snapshots;
    const cutoff = new Date().getTime() - rangeMeta.days * 24 * 60 * 60 * 1000;
    return snapshots.filter((snapshot) => new Date(snapshot.snapshot_at).getTime() >= cutoff);
  }, [snapshots, rangeMeta]);

  // A range with no snapshots in it (but real history elsewhere) falls back
  // to showing everything recorded rather than firing the "tracking starts
  // today" empty state, which would misrepresent a portfolio that already
  // has history just outside the selected window.
  const usingFallback = snapshots.length > 0 && filtered.length === 0;
  const chartSnapshots = usingFallback ? snapshots : filtered;
  const rangeLabel = usingFallback ? "All time" : rangeMeta.label;

  async function takeSnapshot() {
    setSaving(true);
    setMessage("");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setMessage("Sign in required.");
      setSaving(false);
      return;
    }
    try {
      const response = await fetch("/api/portfolio-snapshot", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayCurrency: currency }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setMessage(body.error ?? "Could not take a snapshot.");
      } else {
        setMessage("Snapshot recorded.");
        await onSnapshotTaken();
      }
    } catch {
      setMessage("Could not take a snapshot.");
    }
    setSaving(false);
  }

  return (
    <section aria-labelledby="portfolio-tab-performance" className="portfolio-performance" id="portfolio-panel-performance" role="tabpanel">
      <div className="section-intro portfolio-performance-head">
        <div>
          <p className="eyebrow">Portfolio history</p>
          <h2>Performance</h2>
        </div>
        <div className="portfolio-performance-actions">
          <div aria-label="Time range" className="portfolio-range-selector" role="group">
            {RANGES.map((entry) => (
              <button className={range === entry.key ? "is-active" : ""} key={entry.key} onClick={() => setRange(entry.key)} type="button">{entry.key}</button>
            ))}
          </div>
          <button className="portfolio-snapshot-button" disabled={saving} onClick={() => void takeSnapshot()} type="button">
            {saving ? "Recording…" : "Take a snapshot"}
          </button>
        </div>
      </div>

      <p className="portfolio-performance-explainer">
        Built only from your own recorded snapshots — never estimated, backdated, or drawn from active Scout listings. Each snapshot uses completed, verified RAR sales for the correct print group at the moment it was taken. Gain or loss only appears when purchase price and evidence value are both fully comparable in one currency.
      </p>
      {usingFallback ? <p className="portfolio-performance-note" role="status">No snapshots in the last {rangeMeta.label.toLowerCase()} — showing your full history instead.</p> : null}
      {message ? <p className="portfolio-performance-message" role="status">{message}</p> : null}

      <PortfolioValueChart currency={currency} rangeLabel={rangeLabel} snapshots={chartSnapshots} />
    </section>
  );
}
