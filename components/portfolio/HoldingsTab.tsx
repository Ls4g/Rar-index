"use client";

import { useMemo, useState } from "react";
import HoldingCard, { type Holding } from "@/components/portfolio/HoldingCard";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import { computeHoldingMarketValues, type EditionMarketMetric } from "@/lib/portfolioValuation";
import type { FxRate } from "@/lib/fx";

type FilterKey = "all" | "proven" | "other" | "none";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "proven", label: "Proven first print" },
  { key: "other", label: "Printing not identified" },
  { key: "none", label: "No market evidence" },
];

type HoldingsTabProps = {
  holdings: Holding[];
  metricsByEdition: Map<string, EditionMarketMetric[]>;
  otherSaleCounts: Map<string, number>;
  rates: FxRate[];
  loading: boolean;
  onAddClick: () => void;
  onEdit: (holding: Holding) => void;
  onRemove: (id: string) => void;
};

export default function HoldingsTab({ holdings, metricsByEdition, otherSaleCounts, rates, loading, onAddClick, onEdit, onRemove }: HoldingsTabProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const { currency } = useMarketCurrency();
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  // Same shared valuation the Overview tab and the portfolio totals use, so
  // a holding's gain can never disagree with the figures above it.
  const valueByHolding = useMemo(() => {
    const computed = computeHoldingMarketValues(holdings, metricsByEdition, rates, currency, today);
    return new Map(computed.map((entry) => [entry.holdingId, entry]));
  }, [holdings, metricsByEdition, rates, currency, today]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return holdings.filter((holding) => {
      if (needle) {
        const haystack = [holding.edition?.title, holding.edition?.series, holding.edition?.isbn_13].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      const hasProven = (metricsByEdition.get(holding.edition_id) ?? []).length > 0;
      const otherCount = otherSaleCounts.get(holding.edition_id) ?? 0;
      if (filter === "proven") return hasProven;
      if (filter === "other") return !hasProven && otherCount > 0;
      if (filter === "none") return !hasProven && otherCount === 0;
      return true;
    });
  }, [holdings, query, filter, metricsByEdition, otherSaleCounts]);

  return (
    <div aria-labelledby="portfolio-tab-holdings" className="portfolio-holdings-tab" id="portfolio-panel-holdings" role="tabpanel">
      <div className="section-intro portfolio-holdings-head">
        <div>
          <p className="eyebrow">Your collection</p>
          <h2>Holdings</h2>
        </div>
        <button className="portfolio-add-cta portfolio-add-cta-secondary" onClick={onAddClick} type="button">+ Add holding</button>
      </div>

      {holdings.length ? (
        <div className="portfolio-holdings-controls">
          <input
            aria-label="Search holdings by title, series or ISBN"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search title, series or ISBN"
            type="search"
            value={query}
          />
          <div aria-label="Filter by print status" className="portfolio-filter-chips" role="group">
            {FILTERS.map((entry) => (
              <button className={filter === entry.key ? "is-active" : ""} key={entry.key} onClick={() => setFilter(entry.key)} type="button">
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="status-message">Loading your private portfolio...</p>
      ) : holdings.length ? (
        filtered.length ? (
          <div className="holding-card-grid">
            {filtered.map((holding) => (
              <HoldingCard
                currency={currency}
                holding={holding}
                key={holding.id}
                metrics={metricsByEdition.get(holding.edition_id) ?? []}
                onEdit={onEdit}
                onRemove={onRemove}
                otherSaleCount={otherSaleCounts.get(holding.edition_id) ?? 0}
                value={valueByHolding.get(holding.id) ?? null}
              />
            ))}
          </div>
        ) : (
          <p className="status-message">No holdings match this search or filter.</p>
        )
      ) : (
        <p className="status-message">Add your first RAR edition. Your portfolio will stay private and only use records already in the RAR catalogue.</p>
      )}
    </div>
  );
}
