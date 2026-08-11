"use client";

import { CHART_RANGES, type ChartRangeKey } from "@/lib/chartRanges";

type ChartRangeSelectorProps = {
  value: ChartRangeKey;
  onChange: (key: ChartRangeKey) => void;
  label?: string;
};

export default function ChartRangeSelector({ value, onChange, label = "Time range" }: ChartRangeSelectorProps) {
  return (
    <div aria-label={label} className="chart-range-selector" role="group">
      {CHART_RANGES.map((range) => (
        <button
          aria-label={range.title}
          aria-pressed={value === range.key}
          className={value === range.key ? "is-active" : ""}
          key={range.key}
          onClick={() => onChange(range.key)}
          type="button"
        >
          {range.key === "MAX" ? "All" : range.key}
        </button>
      ))}
    </div>
  );
}
