// One set of time windows for every chart on the site, so an edition's price
// history and the portfolio offer the same choices and describe them with the
// same words. `phrase` is written to drop into a sentence ("no sales in the
// last 3 months"); `title` is the same window as a standalone label.
export const CHART_RANGES = [
  { key: "1M", title: "Last month", phrase: "the last month", days: 30 },
  { key: "3M", title: "Last 3 months", phrase: "the last 3 months", days: 91 },
  { key: "6M", title: "Last 6 months", phrase: "the last 6 months", days: 182 },
  { key: "1Y", title: "Last year", phrase: "the last year", days: 365 },
  { key: "MAX", title: "All recorded history", phrase: "all recorded history", days: null as number | null },
] as const;

export type ChartRange = (typeof CHART_RANGES)[number];
export type ChartRangeKey = ChartRange["key"];

export const DEFAULT_CHART_RANGE: ChartRangeKey = "MAX";

export function chartRange(key: ChartRangeKey): ChartRange {
  return CHART_RANGES.find((range) => range.key === key) ?? CHART_RANGES[CHART_RANGES.length - 1];
}

// Returns the earliest timestamp inside the window, or null for "no limit".
export function chartRangeCutoff(key: ChartRangeKey, now: number = Date.now()): number | null {
  const { days } = chartRange(key);
  return days === null ? null : now - days * 24 * 60 * 60 * 1000;
}
