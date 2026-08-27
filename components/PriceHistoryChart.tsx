"use client";

import { useId, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { convertSale, formatPrice, type ConvertedSale, type FxRate } from "@/lib/fx";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import ChartRangeSelector from "@/components/ChartRangeSelector";
import { chartRange, chartRangeCutoff, type ChartRangeKey } from "@/lib/chartRanges";
import { describeSaleFrequency } from "@/lib/saleFrequency";
import { MIN_COMPARABLE_SALES } from "@/lib/printClassification";
import { buildPriceSeries, defaultVisibleSeries, seriesColourIndex, type PriceSeries, type SeriesSale } from "@/lib/priceSeries";

// One chart, one line per comparison group, and a legend that switches lines
// on and off.
//
// This replaces a stack of separate single-group charts. The evidence rules
// are unchanged and are exactly what produce the lines (see lib/priceSeries.ts):
// a first print, a 3rd printing and a graded copy are three different markets,
// so they are three different paths that never join and are never averaged
// together. Sharing axes is what finally makes them comparable at a glance,
// which is the whole point of putting them on one chart.
//
// Two things had to change structurally to allow it:
//   - x is now a real time scale. The old chart positioned points by index,
//     which is defensible for one line and nonsense for several: two series
//     with different sale dates would be drawn as though their nth sales
//     happened at the same moment.
//   - y is shared, and scaled to the VISIBLE lines only, so hiding an
//     expensive graded line lets the raw lines use the full height instead of
//     being squashed along the bottom of the plot.

type PriceHistoryChartProps = {
  sales: SeriesSale[];
  rates: FxRate[];
  /** Magazines have no printings, so their sales split by grading alone and
   *  the printing wording below would be noise. */
  mode?: "publication_prints" | "exact_issue";
};

// Proportions follow the reference this was rebuilt against: a squat,
// generously inset plot rather than a tall canvas with a line flung across it.
// Three sales stretched over 270px of height and pinned to both edges is what
// made the old chart read as a scribble -- the data was fine, the framing was
// not. The plot is now inset on every side, so a point is never welded to the
// border and the axis labels have somewhere to live.
const WIDTH = 720;
const HEIGHT = 300;
const PADDING_LEFT = 18;
const PADDING_RIGHT = 26;
const PADDING_TOP = 34;
const PADDING_BOTTOM = 38;
const PLOT_WIDTH = WIDTH - PADDING_LEFT - PADDING_RIGHT;
const PLOT_HEIGHT = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
const Y_TICK_COUNT = 5;
const X_TICK_COUNT = 5;

type PlottedPoint = {
  x: number;
  y: number;
  seriesId: string;
  colourIndex: number;
  label: string;
  sale: ConvertedSale<SeriesSale>;
};

function pointKey(point: PlottedPoint) {
  return `${point.seriesId}-${point.sale.sold_date}-${point.sale.sale_price}`;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatDayDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

// Axis labels drop the pennies. "€200" is a scale; "€200.00" is a price, and
// at the width an axis label actually gets it is three wasted characters.
function formatAxisPrice(value: number, code: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: code, currencyDisplay: "narrowSymbol", maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Rounded axis values (10 / 20 / 50 × a power of ten) rather than the raw
 * data's own minimum and maximum. "£89.30" as an axis label is the price of
 * one sale, not a scale; a reader cannot estimate anything between two such
 * numbers, which is why the old high/low pair carried so little.
 */
function niceTicks(min: number, max: number, count = Y_TICK_COUNT) {
  const span = max - min || Math.max(max * 0.2, 1);
  const rough = span / Math.max(1, count - 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= end + step / 2; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

function GhostChart({ best, missingRates }: { best: number; missingRates: number }) {
  return (
    <div className="ghost-chart" aria-label="Price history is not yet available">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-hidden="true">
        <line x1="0" x2={WIDTH} y1={HEIGHT * 0.24} y2={HEIGHT * 0.24} />
        <line x1="0" x2={WIDTH} y1={HEIGHT * 0.5} y2={HEIGHT * 0.5} />
        <line x1="0" x2={WIDTH} y1={HEIGHT * 0.77} y2={HEIGHT * 0.77} />
        <path d={`M 0 ${HEIGHT * 0.69} C 100 ${HEIGHT * 0.55}, 150 ${HEIGHT * 0.68}, 240 ${HEIGHT * 0.52} S 380 ${HEIGHT * 0.41}, 470 ${HEIGHT * 0.57} S 600 ${HEIGHT * 0.37}, 720 ${HEIGHT * 0.44}`} />
      </svg>
      <div className="ghost-chart-message">
        <strong>Not enough comparable verified sales yet</strong>
        <p>
          RAR needs {MIN_COMPARABLE_SALES} verified sales that share a printing and a raw/graded state before it will draw a line.
          Sales may be in different currencies; each is converted at its sale-date rate.
          {best ? ` The strongest group here currently has ${best}.` : ""}
          {missingRates ? ` ${missingRates} sale${missingRates === 1 ? " is" : "s are"} waiting for an exchange-rate record.` : ""}
        </p>
      </div>
    </div>
  );
}

function ThingsToKnow() {
  return (
    <details className="price-things-to-know">
      <summary>Things to know about a sale</summary>
      <ul>
        <li>Each line is one comparison group. RAR never joins a first print to a later printing, or a raw copy to a graded one — those are different markets, so they are different lines.</li>
        <li>RAR keeps raw and graded results separate, but does not create a separate price for every raw-condition detail.</li>
        <li>Check the original listing for completeness and condition. An obi, dust jacket, inserts, signatures, regional differences, or a bundle can materially affect one sale.</li>
        <li>RAR records the original price and currency, then converts it at the reference rate on the sale date for the selected display currency.</li>
      </ul>
    </details>
  );
}

/** Converts each series into the display currency and works out which can be
 *  drawn. Shared by the full-history pass and the range pass so both apply
 *  identical rules. */
function prepareSeries(sales: SeriesSale[], currency: ReturnType<typeof useMarketCurrency>["currency"], rates: FxRate[]) {
  const built = buildPriceSeries(sales);
  const converted = built.map((series) => {
    const convertedSales = series.sales
      .map((sale) => convertSale(sale, currency, rates))
      .filter((sale): sale is ConvertedSale<SeriesSale> => Boolean(sale));
    return {
      ...series,
      convertedSales,
      // Re-checked after conversion: a sale with no exchange-rate record for
      // its date cannot be plotted, so it cannot count towards the minimum.
      chartable: convertedSales.length >= MIN_COMPARABLE_SALES,
    };
  });
  return {
    series: converted,
    best: Math.max(0, ...converted.map((series) => series.convertedSales.length)),
    missingRates: built.reduce((count, series) => count + series.sales.filter((sale) => !convertSale(sale, currency, rates)).length, 0),
  };
}

export default function PriceHistoryChart({ sales, rates, mode = "publication_prints" }: PriceHistoryChartProps) {
  const { currency } = useMarketCurrency();
  const gradientId = useId();
  const [range, setRange] = useState<ChartRangeKey>("MAX");
  // Which lines the reader has explicitly switched off. Stored as the
  // exception rather than as the visible set, so a line that appears later
  // (a new printing, the first graded sale) shows up instead of silently
  // staying hidden because it was not in a stored list.
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const full = useMemo(() => prepareSeries(sales, currency, rates), [sales, currency, rates]);
  const ranged = useMemo(() => {
    const cutoff = chartRangeCutoff(range);
    if (cutoff === null) return full;
    const withinRange = sales.filter((sale) => sale.sold_date && new Date(`${sale.sold_date}T00:00:00`).getTime() >= cutoff);
    return prepareSeries(withinRange, currency, rates);
  }, [sales, currency, rates, range, full]);

  // Narrowing the window can drop every group below the minimum. RAR never
  // draws from fewer than three, so rather than showing a weaker chart the
  // full history returns with the reason stated — the alternative is a reader
  // believing the evidence vanished.
  const usingFallback = range !== "MAX" && !ranged.series.some((series) => series.chartable) && full.series.some((series) => series.chartable);
  const shown = usingFallback ? full : ranged;

  const chartable = useMemo(() => shown.series.filter((series) => series.chartable), [shown]);
  const defaults = useMemo(() => defaultVisibleSeries(chartable as PriceSeries<SeriesSale>[]), [chartable]);
  const visibleSeries = useMemo(
    () => chartable.filter((series) => defaults.includes(series.id) && !hiddenIds.includes(series.id)),
    [chartable, defaults, hiddenIds],
  );

  const plot = useMemo(() => {
    if (!visibleSeries.length) return null;
    const plotWidth = PLOT_WIDTH;
    const baselineY = PADDING_TOP + PLOT_HEIGHT;

    // x spans every chartable line, not only the visible ones, so switching a
    // line off never slides the remaining lines along the time axis.
    //
    // The axis labels are taken from the sale's own date STRING rather than
    // rebuilt from the timestamp. Going back through toISOString() converts
    // to UTC, so a sale dated 1 May parsed in BST became 30 April and the
    // axis under-reported its own range by a day.
    const allDates = chartable
      .flatMap((series) => series.convertedSales.map((sale) => String(sale.sold_date)))
      .sort((left, right) => left.localeCompare(right));
    const firstDate = allDates[0];
    const lastDate = allDates.at(-1) as string;
    const firstTime = new Date(`${firstDate}T00:00:00`).getTime();
    const lastTime = new Date(`${lastDate}T00:00:00`).getTime();
    const timeSpan = lastTime - firstTime || 1;

    const values = visibleSeries.flatMap((series) => series.convertedSales.map((sale) => sale.converted_price));
    // The scale runs between rounded tick values, so every line sits inside
    // the gridlines instead of touching the top and bottom of the frame.
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const scaleMin = ticks[0];
    const scaleMax = ticks.at(-1) as number;
    const valueRange = scaleMax - scaleMin || Math.max(scaleMax * 0.1, 1);
    const yFor = (value: number) => PADDING_TOP + ((scaleMax - value) / valueRange) * PLOT_HEIGHT;

    // Evenly spaced date ticks across the span, so the reader can place a
    // point in time rather than only knowing where the range starts and ends.
    //
    // Granularity follows the span. A publication whose sales cover two months
    // produced "May 26, May 26, Jun 26, Jun 26, Jul 26" at month resolution --
    // five ticks saying three things. Short spans get the day; long spans get
    // month and year; and any label that would repeat its neighbour is dropped
    // rather than printed twice.
    const spanDays = timeSpan / 86_400_000;
    const tickFormat = new Intl.DateTimeFormat("en-GB", spanDays <= 120
      ? { day: "numeric", month: "short" }
      : { month: "short", year: "2-digit" });
    const rawTicks = Array.from({ length: X_TICK_COUNT }, (_, index) => {
      const ratio = index / (X_TICK_COUNT - 1);
      const date = new Date(firstTime + ratio * timeSpan);
      return { x: PADDING_LEFT + ratio * plotWidth, date, label: tickFormat.format(date) };
    });
    const xTicks = rawTicks.filter((tick, index) => index === 0 || tick.label !== rawTicks[index - 1].label);

    const lines = visibleSeries.map((series) => {
      const colourIndex = seriesColourIndex(chartable as PriceSeries<SeriesSale>[], series.id);
      const points: PlottedPoint[] = series.convertedSales.map((sale) => ({
        x: PADDING_LEFT + ((new Date(`${sale.sold_date}T00:00:00`).getTime() - firstTime) / timeSpan) * plotWidth,
        y: yFor(sale.converted_price),
        seriesId: series.id,
        colourIndex,
        label: series.label,
        sale,
      }));
      return {
        series,
        colourIndex,
        points,
        path: points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" "),
      };
    });

    return { lines, allPoints: lines.flatMap((line) => line.points), ticks, yFor, xTicks, baselineY, firstDate, lastDate };
  }, [visibleSeries, chartable]);

  const activePoint = useMemo(() => {
    if (!plot || !plot.allPoints.length) return null;
    const found = plot.allPoints.find((point) => pointKey(point) === activeKey);
    if (found) return found;
    // Defaults to the most recent sale on screen, whichever line it is on.
    return [...plot.allPoints].sort((left, right) => String(left.sale.sold_date).localeCompare(String(right.sale.sold_date))).at(-1) ?? null;
  }, [plot, activeKey]);

  function toggleSeries(id: string) {
    const isVisible = visibleSeries.some((series) => series.id === id);
    // The last visible line cannot be switched off: an empty plot under a
    // full legend reads as a broken chart rather than a chosen view.
    if (isVisible && visibleSeries.length === 1) return;
    setHiddenIds((current) => (isVisible ? [...new Set([...current, id])] : current.filter((entry) => entry !== id)));
  }

  function updateActiveFromClientX(clientX: number, wrap: HTMLDivElement) {
    if (!plot || !plot.allPoints.length) return;
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * WIDTH;
    let nearest = plot.allPoints[0];
    let nearestDistance = Infinity;
    for (const point of plot.allPoints) {
      const distance = Math.abs(point.x - svgX);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = point;
      }
    }
    setActiveKey(pointKey(nearest));
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!plot || !activePoint) return;
    const ordered = [...plot.allPoints].sort((left, right) => left.x - right.x);
    const index = ordered.findIndex((point) => pointKey(point) === pointKey(activePoint));
    const move = (next: number) => setActiveKey(pointKey(ordered[Math.min(ordered.length - 1, Math.max(0, next))]));
    if (event.key === "ArrowRight") { event.preventDefault(); move(index + 1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); move(index - 1); }
    else if (event.key === "Home") { event.preventDefault(); move(0); }
    else if (event.key === "End") { event.preventDefault(); move(ordered.length - 1); }
  }

  if (!full.series.some((series) => series.chartable)) {
    return (
      <div className="price-history-card price-history-empty">
        <div className="price-history-heading">
          <div>
            <p className="eyebrow">RAR market history</p>
            <h2>Price history</h2>
          </div>
          <span className="chart-status">Evidence building</span>
        </div>
        <GhostChart best={full.best} missingRates={full.missingRates} />
        <ThingsToKnow />
      </div>
    );
  }

  const uncharted = shown.series.filter((series) => !series.chartable);
  const frequency = describeSaleFrequency(visibleSeries.flatMap((series) => series.convertedSales.map((sale) => sale.sold_date)));
  const totalShown = visibleSeries.reduce((count, series) => count + series.convertedSales.length, 0);
  const showsOriginal = activePoint && activePoint.sale.currency !== currency;

  const headlineSeries = visibleSeries[0];
  const headline = headlineSeries?.convertedSales.at(-1) ?? null;
  const headlinePrevious = headlineSeries?.convertedSales.at(-2) ?? null;
  const headlineChange = headline && headlinePrevious && headlinePrevious.converted_price
    ? (() => {
      const difference = headline.converted_price - headlinePrevious.converted_price;
      if (!difference) return { direction: "is-flat", text: "Level" };
      const percent = Math.round(Math.abs(difference / headlinePrevious.converted_price) * 100);
      return {
        direction: difference > 0 ? "is-up" : "is-down",
        text: `${difference > 0 ? "+" : "−"}${formatPrice(Math.abs(difference), currency)} (${percent}%)`,
      };
    })()
    : null;

  return (
    <div className="price-history-multi">
      <div className="price-history-heading">
        <div>
          <p className="eyebrow">RAR market history</p>
          <h2>Price history</h2>
        </div>
        <ChartRangeSelector label="Price history time range" onChange={setRange} value={range} />
      </div>

      {usingFallback ? (
        <p className="chart-range-note" role="status">
          Not enough comparable sales in {chartRange(range).phrase} — RAR needs {MIN_COMPARABLE_SALES} sharing a printing and a raw/graded state, so the full history is shown instead.
        </p>
      ) : null}

      {/* The legend is the control, not a key. Each entry says how many sales
          back the line and what the latest one was, so the decision about
          what to compare can be made without opening anything. */}
      <ul className="chart-legend" aria-label="Comparison groups on this chart">
        {chartable.map((series) => {
          const on = visibleSeries.some((entry) => entry.id === series.id);
          const latest = series.convertedSales.at(-1);
          return (
            <li key={series.id}>
              <button
                aria-pressed={on}
                className={`chart-legend-toggle${on ? " is-on" : ""}`}
                data-graded={series.graded ? "true" : undefined}
                data-series-colour={seriesColourIndex(chartable as PriceSeries<SeriesSale>[], series.id)}
                onClick={() => toggleSeries(series.id)}
                type="button"
              >
                <span className="chart-legend-swatch" aria-hidden="true" />
                <span className="chart-legend-label">{series.label}</span>
                <span className="chart-legend-meta">
                  {series.convertedSales.length} sale{series.convertedSales.length === 1 ? "" : "s"}
                  {latest ? ` · ${formatPrice(latest.converted_price, currency)}` : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* A figure to anchor the plot, taken from the leading visible line --
          first print whenever there is one, since that is the line the page
          is really about. The comparison is deliberately narrow: it is the
          step between two consecutive verified sales of the SAME group, not
          a market trend, and the wording has to say so. Two sales are two
          sales. */}
      {headline ? (
        <div className="chart-headline">
          <p className="chart-headline-label">{headlineSeries?.label} · latest verified sale</p>
          <p className="chart-headline-figure">{formatPrice(headline.converted_price, currency)}</p>
          <p className="chart-headline-meta">
            {formatDayDate(String(headline.sold_date))}
            {headlineChange ? (
              <>
                {" · "}
                <span className={headlineChange.direction}>{headlineChange.text}</span>
                {" on the previous verified sale"}
              </>
            ) : null}
          </p>
        </div>
      ) : null}

      {plot && activePoint ? (
        <>
          <div
            aria-label="Verified sale prices. Use the left and right arrow keys to move between individual sales."
            className="price-chart-wrap"
            onKeyDown={handleKeyDown}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => updateActiveFromClientX(event.clientX, event.currentTarget)}
            onPointerLeave={() => setActiveKey(null)}
            onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => { if (event.pointerType !== "touch") updateActiveFromClientX(event.clientX, event.currentTarget); }}
            role="group"
            tabIndex={0}
          >
            {/* The lone-line area fill takes that line's own colour, so a
                first print washes gold and a later printing washes its own
                hue rather than every chart fading to the same gold. */}
            <svg className="price-chart is-multi" role="img" aria-hidden="true" data-series-colour={plot.lines[0].colourIndex} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop className="chart-gradient-start" offset="0%" />
                  <stop className="chart-gradient-end" offset="100%" />
                </linearGradient>
              </defs>
              {/* A real scale, not two floating numbers. Rounded gridlines
                  let a reader estimate a value anywhere on the plot, which is
                  the difference between a chart and a squiggle. */}
              {plot.ticks.map((tick) => (
                <g key={tick}>
                  <line className="chart-gridline" x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={plot.yFor(tick)} y2={plot.yFor(tick)} />
                  <text className="chart-axis-label" x={PADDING_LEFT} y={plot.yFor(tick) - 6}>{formatAxisPrice(tick, currency)}</text>
                </g>
              ))}
              {plot.xTicks.map((tick, index) => (
                <text
                  className="chart-axis-label"
                  key={tick.date.getTime()}
                  textAnchor={index === 0 ? "start" : index === plot.xTicks.length - 1 ? "end" : "middle"}
                  x={tick.x}
                  y={HEIGHT - 12}
                >
                  {tick.label}
                </text>
              ))}
              <line className="chart-active-guide" x1={activePoint.x} x2={activePoint.x} y1={PADDING_TOP} y2={plot.baselineY} />

              {/* A single line keeps its area fill; several would layer
                  translucent washes over each other and muddy every colour. */}
              {plot.lines.length === 1 ? (
                <path
                  className="price-chart-area"
                  d={`M ${plot.lines[0].points[0].x} ${plot.baselineY} ${plot.lines[0].points.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${plot.lines[0].points.at(-1)!.x} ${plot.baselineY} Z`}
                  fill={`url(#${gradientId})`}
                />
              ) : null}

              {plot.lines.map((line) => (
                <g className="chart-series" data-graded={line.series.graded ? "true" : undefined} data-series-colour={line.colourIndex} key={line.series.id}>
                  <path className="chart-series-line" d={line.path} />
                  {line.points.map((point) => {
                    const isActive = pointKey(point) === pointKey(activePoint);
                    return (
                      <circle
                        className={`price-chart-point${isActive ? " is-active" : ""}`}
                        cx={point.x}
                        cy={point.y}
                        key={`${point.sale.sold_date}-${point.sale.sale_price}-${point.sale.currency}`}
                        r={isActive ? 6 : 3}
                      >
                        <title>{`${line.series.label} · ${formatShortDate(String(point.sale.sold_date))}: ${formatPrice(point.sale.sale_price, point.sale.currency)} → ${formatPrice(point.sale.converted_price, currency)}`}</title>
                      </circle>
                    );
                  })}
                </g>
              ))}

            </svg>

            <div
              aria-hidden="true"
              className={`chart-tooltip${activePoint.y < PADDING_TOP + PLOT_HEIGHT * 0.32 ? " is-below" : ""}`}
              data-series-colour={activePoint.colourIndex}
              style={{ left: `${Math.min(90, Math.max(10, (activePoint.x / WIDTH) * 100))}%`, top: `${(activePoint.y / HEIGHT) * 100}%` }}
            >
              <strong>{formatPrice(activePoint.sale.converted_price, currency)}</strong>
              <span>{formatShortDate(String(activePoint.sale.sold_date))}</span>
              <em>{activePoint.label}</em>
            </div>
          </div>

          <p className="chart-active-summary" aria-live="polite">
            {activePoint.label} · {formatShortDate(String(activePoint.sale.sold_date))} · {formatPrice(activePoint.sale.converted_price, currency)}
            {showsOriginal ? ` (originally ${formatPrice(activePoint.sale.sale_price, activePoint.sale.currency)})` : ""}
          </p>
        </>
      ) : null}

      {/* Groups that exist but cannot be drawn are named rather than dropped.
          Silently omitting them would make the page look like it holds less
          evidence than it does. */}
      {uncharted.length ? (
        <p className="chart-belowbar-note">
          Not charted yet — {MIN_COMPARABLE_SALES} sales are needed in one group:{" "}
          {uncharted.map((series) => `${series.label} (${series.convertedSales.length})`).join(", ")}.
          {mode === "publication_prints" ? " A sale whose printing cannot be proven is never mixed into a printed group." : ""}
        </p>
      ) : null}

      <p className="chart-note">
        {totalShown} verified sale{totalShown === 1 ? "" : "s"} shown in {currency}
        {frequency ? ` · sells ${frequency.label}` : ""}. Lines are never joined across printings or across raw and graded — those are
        separate markets. Amounts are converted using European Central Bank reference rates from each sale date; the original price and
        currency stay visible in the sale record below.
      </p>
      <ThingsToKnow />
    </div>
  );
}
