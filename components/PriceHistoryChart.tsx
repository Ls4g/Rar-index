"use client";

import { useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { convertSale, formatPrice, type ConvertedSale, type FxRate } from "@/lib/fx";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import ChartRangeSelector from "@/components/ChartRangeSelector";
import { chartRange, chartRangeCutoff, type ChartRangeKey } from "@/lib/chartRanges";
import { MIN_COMPARABLE_SALES } from "@/lib/printClassification";
import { buildPriceSeries, mayDrawPriceLine, seriesColourIndex, type PriceSeries, type SeriesSale } from "@/lib/priceSeries";

type PriceHistoryChartProps = { sales: SeriesSale[]; rates: FxRate[] };
type DisplaySale = ConvertedSale<SeriesSale>;
type DisplaySeries = PriceSeries<SeriesSale> & { convertedSales: DisplaySale[] };
type Market = "raw" | "graded";

const CHART_WIDTH = 720;
const CHART_HEIGHT = 240;
const INSET_X = 12;
const INSET_Y = 18;

function saleTime(date: string) {
  // Noon UTC avoids the BST midnight rollover that once put 1 May at 30 Apr.
  return Date.parse(`${date}T12:00:00Z`);
}

function formatSaleDate(date: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(saleTime(date));
}

function formatAxisDate(time: number, includeYear: boolean) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", ...(includeYear ? { year: "2-digit" } : {}), timeZone: "UTC",
  }).format(time);
}

function formatAxisPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency, currencyDisplay: "narrowSymbol",
    maximumFractionDigits: value > 0 && value < 5 ? 2 : 0,
  }).format(value);
}

function priceScale(lowest: number, highest: number) {
  const spread = highest - lowest;
  const padding = spread ? spread * 0.18 : Math.max(highest * 0.12, 1);
  const targetMin = Math.max(0, lowest - padding);
  const targetMax = highest + padding;
  const roughStep = (targetMax - targetMin) / 2;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude).find((candidate) => candidate >= roughStep) ?? 10 * magnitude;
  // Round labels to a readable scale rather than making sale-derived values
  // such as £34.73 or £197.93 look like meaningful benchmarks.
  return {
    min: Number((Math.floor(targetMin / step) * step).toFixed(6)),
    max: Number((Math.ceil(targetMax / step) * step).toFixed(6)),
  };
}

function priceRuler(min: number, max: number) {
  const span = max - min || 1;
  const magnitude = 10 ** Math.floor(Math.log10(span / 4));
  const steps = [1, 2, 2.5, 5, 10].map((multiple) => multiple * magnitude);
  // Prefer a round increment that divides the scale into three to six bands.
  // Black Clover's £0–£400 scale therefore gets £100 labels, while much
  // larger or smaller markets keep a readable number of labels.
  const step = steps.find((candidate) => {
    const bands = span / candidate;
    return bands >= 3 && bands <= 6 && Math.abs(bands - Math.round(bands)) < 0.000001;
  }) ?? steps.find((candidate) => span / candidate <= 5) ?? 10 * magnitude;
  const values = Array.from({ length: Math.floor(span / step) + 1 }, (_, index) => Number((min + index * step).toFixed(6)));
  if (Math.abs(values.at(-1)! - max) > 0.000001) values.push(max);
  const y = (value: number) => INSET_Y + (max - value) / span * (CHART_HEIGHT - INSET_Y * 2);
  const major = values.map((value) => ({ value, y: y(value) }));
  const minor = values.slice(0, -1).flatMap((value, index) =>
    [1, 2, 3].map((quarter) => ({
      y: y(value + (values[index + 1] - value) * quarter / 4),
      midpoint: quarter === 2,
    }))
  );
  return { major, minor };
}

function pointKey(sale: DisplaySale) {
  return sale.id ?? `${sale.sold_date}-${sale.sale_price}-${sale.currency}`;
}

function prepareSeries(sales: SeriesSale[], currency: ReturnType<typeof useMarketCurrency>["currency"], rates: FxRate[]) {
  const built = buildPriceSeries(sales);
  const series: DisplaySeries[] = built.map((entry) => {
    const convertedSales = entry.sales
      .map((sale) => convertSale(sale, currency, rates))
      .filter((sale): sale is DisplaySale => Boolean(sale));
    return { ...entry, convertedSales, chartable: mayDrawPriceLine(convertedSales.length) };
  });
  return {
    series: series.filter((entry) => entry.convertedSales.length),
    missingRates: built.reduce((total, entry) => total + entry.sales.filter((sale) => !convertSale(sale, currency, rates)).length, 0),
    missingDetails: sales.length - built.reduce((total, entry) => total + entry.sales.length, 0),
  };
}

function makePlot(sales: DisplaySale[]) {
  if (!sales.length) return null;
  const ordered = [...sales].sort((a, b) => String(a.sold_date).localeCompare(String(b.sold_date)));
  const times = ordered.map((sale) => saleTime(String(sale.sold_date)));
  const firstTime = times[0];
  const lastTime = times.at(-1) as number;
  const span = lastTime - firstTime;
  const values = ordered.map((sale) => sale.converted_price);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const { min, max } = priceScale(lowest, highest);
  const yRange = max - min || 1;
  const bottom = CHART_HEIGHT - INSET_Y;
  const points = ordered.map((sale, index) => ({
    sale,
    x: INSET_X + (span ? (times[index] - firstTime) / span : 0.5) * (CHART_WIDTH - INSET_X * 2),
    y: INSET_Y + (max - sale.converted_price) / yRange * (CHART_HEIGHT - INSET_Y * 2),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `M ${points[0].x.toFixed(1)} ${bottom} ${points.map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")} L ${points.at(-1)!.x.toFixed(1)} ${bottom} Z`;
  // Calendar ticks describe the time axis, not additional sales. The exact
  // date of each recorded sale remains available through the point inspector.
  const dayCount = Math.round(span / 86_400_000);
  const tickCount = Math.min(5, dayCount + 1);
  const includeYear = new Date(firstTime).getUTCFullYear() !== new Date(lastTime).getUTCFullYear();
  const labels = Array.from({ length: tickCount }, (_, index) => {
    const time = tickCount === 1 ? firstTime : firstTime + span * index / (tickCount - 1);
    return formatAxisDate(time, includeYear);
  });
  return { points, line, area, labels, max, min, ruler: priceRuler(min, max), firstTime, lastTime };
}

function ThingsToKnow() {
  return (
    <details className="price-things-to-know">
      <summary>About these sale prices</summary>
      <ul>
        <li>Each point is a verified completed sale. Straight segments join sale dates; RAR does not know the price between those dates.</li>
        <li>Raw and graded copies never share a chart scale. Different printings and grades remain separate selectable groups.</li>
        <li>“Printing not identified” is its own group, not a claim that all those copies share a printing.</li>
        <li>Condition, completeness, signatures and included extras can affect individual sale prices. Check the original listing for context.</li>
        <li>RAR keeps the original price and currency, then converts it at the reference rate for the sale date.</li>
      </ul>
    </details>
  );
}

export default function PriceHistoryChart({ sales, rates }: PriceHistoryChartProps) {
  const { currency } = useMarketCurrency();
  const [range, setRange] = useState<ChartRangeKey>("MAX");
  const [market, setMarket] = useState<Market>("raw");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);

  const prepared = useMemo(() => prepareSeries(sales, currency, rates), [sales, currency, rates]);
  const raw = prepared.series.filter((entry) => !entry.graded);
  const graded = prepared.series.filter((entry) => entry.graded);
  const activeMarket: Market = market === "raw" && !raw.length ? "graded" : market === "graded" && !graded.length ? "raw" : market;
  const choices = activeMarket === "raw" ? raw : graded;
  const preferred = choices.find((entry) => entry.chartable) ?? choices[0];
  const selected = choices.find((entry) => entry.id === selectedId) ?? preferred;
  const cutoff = chartRangeCutoff(range);
  const inRange = selected?.convertedSales.filter((sale) => cutoff === null || saleTime(String(sale.sold_date)) >= cutoff) ?? [];
  const usingFallback = Boolean(selected && cutoff !== null && !inRange.length);
  const shownSales = usingFallback ? selected?.convertedSales ?? [] : inRange;
  const hasLine = mayDrawPriceLine(shownSales.length);
  const plot = makePlot(shownSales);
  const active = plot?.points.find((point) => pointKey(point.sale) === activeKey) ?? plot?.points.at(-1) ?? null;
  const colourIndex = selected ? seriesColourIndex(prepared.series, selected.id) : 0;
  const recordedPrices = shownSales.map((sale) => sale.converted_price);
  const recordedLow = recordedPrices.length ? Math.min(...recordedPrices) : null;
  const recordedHigh = recordedPrices.length ? Math.max(...recordedPrices) : null;

  function inspectAt(clientX: number, element: HTMLDivElement) {
    if (!plot) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width) return;
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * CHART_WIDTH;
    const nearest = plot.points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best);
    setActiveKey(pointKey(nearest.sale));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!plot || !active) return;
    const index = plot.points.findIndex((point) => pointKey(point.sale) === pointKey(active.sale));
    const next = event.key === "ArrowRight" ? index + 1 : event.key === "ArrowLeft" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? plot.points.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActiveKey(pointKey(plot.points[Math.max(0, Math.min(plot.points.length - 1, next))].sale));
  }

  if (!prepared.series.length) {
    return (
      <div className="price-history-multi market-chart-empty">
        <div className="price-history-heading"><div><p className="eyebrow">RAR market history</p><h2>Price history</h2></div></div>
        <p>No sale prices can be plotted yet.{prepared.missingRates ? ` ${prepared.missingRates} sale${prepared.missingRates === 1 ? " needs" : "s need"} an exchange rate.` : ""}</p>
        <ThingsToKnow />
      </div>
    );
  }

  return (
    <div className="price-history-multi market-chart" data-series-colour={colourIndex}>
      <div className="price-history-heading">
        <div><p className="eyebrow">RAR market history</p><h2>Verified sale history</h2></div>
        <ChartRangeSelector label="Price history time range" onChange={(next) => { setRange(next); setActiveKey(null); setInspecting(false); }} value={range} />
      </div>

      <div className="market-chart-markets" aria-label="Choose sale type">
        {(["raw", "graded"] as const).map((value) => {
          const groups = value === "raw" ? raw : graded;
          const count = groups.reduce((total, entry) => total + entry.convertedSales.length, 0);
          return groups.length ? (
            <button aria-pressed={activeMarket === value} className={activeMarket === value ? "is-active" : ""} key={value} onClick={() => { setMarket(value); setActiveKey(null); setInspecting(false); }} type="button">
              {value === "raw" ? "Raw copies" : "Graded copies"}<span>{count} sale{count === 1 ? "" : "s"}</span>
            </button>
          ) : null;
        })}
      </div>

      {choices.length > 1 ? (
        <div className="market-chart-groups" aria-label="Choose printing or grade">
          {choices.map((entry) => (
            <button aria-pressed={selected?.id === entry.id} className={selected?.id === entry.id ? "is-active" : ""} key={entry.id} onClick={() => { setSelectedId(entry.id); setActiveKey(null); setInspecting(false); }} type="button">
              <strong>{entry.label}</strong><span>{entry.convertedSales.length} sale{entry.convertedSales.length === 1 ? "" : "s"}</span>
            </button>
          ))}
        </div>
      ) : null}

      {selected && active && plot ? (
        <>
          {usingFallback ? <p className="chart-range-note" role="status">No {selected.label.toLowerCase()} sales in {chartRange(range).phrase}; showing all recorded dates.</p> : null}
          <div className="market-chart-feature">
            <div>
              <p className="market-chart-group-name">{selected.label}</p>
              <strong className="market-chart-active-price">{formatPrice(active.sale.converted_price, currency)}</strong>
              <p className="market-chart-active-date">Sold {formatSaleDate(String(active.sale.sold_date))}{active.sale.currency !== currency ? ` · originally ${formatPrice(active.sale.sale_price, active.sale.currency)}` : ""}</p>
              {hasLine && active.sale.source_listing_url ? <a className="market-chart-active-source" href={active.sale.source_listing_url} rel="noreferrer" target="_blank">View this sale’s original listing ↗</a> : null}
            </div>
            <span className="market-chart-count">{shownSales.length} verified sale{shownSales.length === 1 ? "" : "s"}</span>
          </div>

          {hasLine ? (
            <>
              <div className="market-chart-frame">
                <div className="market-chart-y-axis" aria-label={`Price scale from ${formatPrice(plot.min, currency)} to ${formatPrice(plot.max, currency)}`}>
                  {plot.ruler.major.map(({ value, y }) => (
                    <span key={value} style={{ top: `${y / CHART_HEIGHT * 100}%` }}>{formatAxisPrice(value, currency)}</span>
                  ))}
                </div>
                <div className="market-chart-plot" aria-label={`Verified ${selected.label} sales from ${formatSaleDate(String(plot.points[0].sale.sold_date))} to ${formatSaleDate(String(plot.points.at(-1)!.sale.sold_date))}. Use arrow keys to inspect individual sales.`} onBlur={() => setInspecting(false)} onFocus={() => setInspecting(true)} onKeyDown={handleKeyDown} onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => { inspectAt(event.clientX, event.currentTarget); setInspecting(true); }} onPointerLeave={() => setInspecting(false)} onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType !== "touch") { inspectAt(event.clientX, event.currentTarget); setInspecting(true); } }} role="group" tabIndex={0}>
                  <svg aria-hidden="true" preserveAspectRatio="none" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
                    {plot.ruler.major.map(({ value, y }) => <line className="market-chart-grid" key={value} x1="0" x2={CHART_WIDTH} y1={y} y2={y} />)}
                    <line className="market-chart-ruler-spine" x1="0" x2="0" y1={INSET_Y} y2={CHART_HEIGHT - INSET_Y} />
                    {plot.ruler.minor.map(({ y, midpoint }, index) => <line className={midpoint ? "market-chart-ruler-midpoint" : "market-chart-ruler-tick"} key={index} x1="0" x2={midpoint ? 34 : 22} y1={y} y2={y} />)}
                    <path className="market-chart-area" d={plot.area} />
                    <path className="market-chart-line" d={plot.line} />
                    {active ? <line className="market-chart-guide" x1={active.x} x2={active.x} y1={INSET_Y} y2={CHART_HEIGHT - INSET_Y} /> : null}
                  </svg>
                  {plot.points.map((point) => <span aria-hidden="true" className="market-chart-sale-point" key={pointKey(point.sale)} style={{ left: `${point.x / CHART_WIDTH * 100}%`, top: `${point.y / CHART_HEIGHT * 100}%` }} />)}
                  {active ? <span aria-hidden="true" className="market-chart-marker" style={{ left: `${active.x / CHART_WIDTH * 100}%`, top: `${active.y / CHART_HEIGHT * 100}%` }} /> : null}
                  {active && inspecting ? <span aria-hidden="true" className={`market-chart-tooltip${active.y < 60 ? " is-below" : ""}`} style={{ left: `${Math.max(16, Math.min(84, active.x / CHART_WIDTH * 100))}%`, top: `${active.y / CHART_HEIGHT * 100}%` }}><strong>{formatPrice(active.sale.converted_price, currency)}</strong><small>{formatSaleDate(String(active.sale.sold_date))}</small></span> : null}
                </div>
              </div>
              <div className={`market-chart-x-axis${plot.labels.length === 1 ? " is-single" : ""}${plot.labels.length === 5 ? " has-five-ticks" : ""}`} aria-label="Calendar dates, earliest to latest">
                {plot.labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
              </div>
              {recordedLow !== null && recordedHigh !== null ? <div className="market-chart-recorded-range"><span>Lowest recorded<strong>{formatPrice(recordedLow, currency)}</strong></span><span>Highest recorded<strong>{formatPrice(recordedHigh, currency)}</strong></span></div> : null}
              <p className="market-chart-footnote">Calendar dates run left to right. Move across the line for each sale’s exact date and price; the line does not estimate prices between sales.</p>
            </>
          ) : (
            <div className="market-chart-sparse">
              <p>{shownSales.length} recorded sale{shownSales.length === 1 ? "" : "s"} for this group. {MIN_COMPARABLE_SALES} are needed for a line, so the receipts are shown directly.</p>
              <div className="market-chart-sale-cards">
                {[...shownSales].reverse().map((sale) => (
                  <div className="market-chart-sale-card" key={pointKey(sale)}>
                    <strong>{formatPrice(sale.converted_price, currency)}</strong>
                    <span>{formatSaleDate(String(sale.sold_date))}</span>
                    {sale.currency !== currency ? <small>Originally {formatPrice(sale.sale_price, sale.currency)}</small> : null}
                    {sale.source_listing_url ? <a href={sale.source_listing_url} rel="noreferrer" target="_blank">Original sale ↗</a> : null}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}

      {prepared.missingRates || prepared.missingDetails ? <p className="chart-note">{prepared.missingRates ? `${prepared.missingRates} sale${prepared.missingRates === 1 ? " needs" : "s need"} an exchange rate. ` : ""}{prepared.missingDetails ? `${prepared.missingDetails} sale${prepared.missingDetails === 1 ? " needs" : "s need"} a date or grading review.` : ""}</p> : null}
      <ThingsToKnow />
    </div>
  );
}
