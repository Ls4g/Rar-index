"use client";

import { comparisonGroup, convertSale, formatPrice, type FxRate, type MarketSale } from "@/lib/fx";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";

type SalePoint = MarketSale;

type PriceHistoryChartProps = {
  sales: SalePoint[];
  rates: FxRate[];
};

const WIDTH = 720;
const HEIGHT = 230;
const PADDING_X = 28;
const PADDING_TOP = 26;
const PADDING_BOTTOM = 34;
const MIN_COMPARABLE_SALES = 3;

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function GhostChart({ comparableCount, missingRates }: { comparableCount: number; missingRates: number }) {
  return (
    <div className="ghost-chart" aria-label="Price history is not yet available">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-hidden="true">
        <line x1="0" x2={WIDTH} y1="54" y2="54" />
        <line x1="0" x2={WIDTH} y1="115" y2="115" />
        <line x1="0" x2={WIDTH} y1="176" y2="176" />
        <path d="M 0 158 C 100 127, 150 156, 240 120 S 380 94, 470 132 S 600 84, 720 102" />
      </svg>
      <div className="ghost-chart-message">
        <strong>Not enough comparable verified sales yet</strong>
        <p>RAR needs {MIN_COMPARABLE_SALES} verified sales in the same raw/graded group. Sales may be in different currencies; each is converted at its sale-date rate.{comparableCount ? ` This group currently has ${comparableCount}.` : ""}{missingRates ? ` ${missingRates} sale${missingRates === 1 ? " is" : "s are"} waiting for an exchange-rate record.` : ""}</p>
      </div>
    </div>
  );
}

function ThingsToKnow() {
  return (
    <details className="price-things-to-know">
      <summary>Things to know about a sale</summary>
      <ul>
        <li>RAR keeps raw and graded results separate, but does not create a separate price for every raw-condition detail.</li>
        <li>Check the original listing for completeness and condition. An obi, dust jacket, inserts, signatures, regional differences, or a bundle can materially affect one sale.</li>
        <li>RAR records the original price and currency, then converts it at the reference rate on the sale date for the selected display currency.</li>
      </ul>
    </details>
  );
}

function ComparableChart({ label, sales }: {
  label: string;
  sales: Array<NonNullable<ReturnType<typeof convertSale<SalePoint>>>>;
}) {
  const { currency } = useMarketCurrency();
  const values = sales.map((sale) => sale.converted_price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(max * 0.1, 1);
  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const points = sales.map((sale, index) => ({
    x: PADDING_X + (index / (sales.length - 1)) * plotWidth,
    y: PADDING_TOP + ((max - sale.converted_price) / range) * plotHeight,
    sale,
  }));
  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
  const firstDate = sales[0].sold_date!;
  const lastDate = sales.at(-1)?.sold_date;

  return (
    <article className="price-history-card comparable-chart-card">
      <div className="price-history-heading">
        <div>
          <p className="eyebrow">Comparable verified sales</p>
          <h2>Verified sales</h2>
        </div>
        <span className="chart-status">{sales.length} sales</span>
      </div>
      <p className="chart-comparable-label">{label} · shown in {currency}</p>
      <div className="price-chart-wrap">
        <svg className="price-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Price history from ${formatShortDate(firstDate)} to ${formatShortDate(lastDate ?? firstDate)} in ${currency}`}>
          <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP} y2={PADDING_TOP} />
          <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP + plotHeight / 2} y2={PADDING_TOP + plotHeight / 2} />
          <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP + plotHeight} y2={PADDING_TOP + plotHeight} />
          <polyline points={pointString} />
          {points.map((point) => (
            <circle cx={point.x} cy={point.y} r="5" key={`${point.sale.sold_date}-${point.sale.sale_price}-${point.sale.currency}`}>
              <title>{`${formatShortDate(point.sale.sold_date!)}: ${formatPrice(point.sale.sale_price, point.sale.currency)} → ${formatPrice(point.sale.converted_price, currency)}`}</title>
            </circle>
          ))}
          <text x={PADDING_X} y={HEIGHT - 8}>{formatShortDate(firstDate)}</text>
          <text x={WIDTH - PADDING_X} y={HEIGHT - 8} textAnchor="end">{formatShortDate(lastDate ?? firstDate)}</text>
        </svg>
        <div className="chart-range" aria-hidden="true">
          <span>{formatPrice(max, currency)}</span>
          <span>{formatPrice(min, currency)}</span>
        </div>
      </div>
    </article>
  );
}

export default function PriceHistoryChart({ sales, rates }: PriceHistoryChartProps) {
  const { currency } = useMarketCurrency();
  const groups = new Map<string, { label: string; sales: SalePoint[] }>();

  sales.filter((sale): sale is SalePoint & { sold_date: string } => Boolean(sale.sold_date)).forEach((sale) => {
    const group = comparisonGroup(sale);
    const current = groups.get(group.key) ?? { label: group.grading, sales: [] };
    current.sales.push(sale);
    groups.set(group.key, current);
  });

  const comparableGroups = [...groups.values()]
    .map((group) => ({
      ...group,
      sales: group.sales.sort((a, b) => a.sold_date!.localeCompare(b.sold_date!)),
    }))
    .sort((a, b) => b.sales.length - a.sales.length);
  const convertedGroups = comparableGroups.map((group) => ({
    ...group,
    convertedSales: group.sales.map((sale) => convertSale(sale, currency, rates)).filter((sale): sale is NonNullable<typeof sale> => Boolean(sale)),
  }));
  const chartGroups = convertedGroups.filter((group) => group.convertedSales.length >= MIN_COMPARABLE_SALES);
  const bestGroupCount = comparableGroups[0]?.sales.length ?? 0;
  const missingRates = comparableGroups.reduce((count, group) => count + group.sales.filter((sale) => !convertSale(sale, currency, rates)).length, 0);

  if (!chartGroups.length) {
    return (
      <div className="price-history-card price-history-empty">
        <div className="price-history-heading">
          <div>
            <p className="eyebrow">RAR market history</p>
            <h2>Price history</h2>
          </div>
          <span className="chart-status">Evidence building</span>
        </div>
        <GhostChart comparableCount={bestGroupCount} missingRates={missingRates} />
        <ThingsToKnow />
      </div>
    );
  }

  return (
    <div>
      <div className="price-history-heading">
        <div>
          <p className="eyebrow">RAR market history</p>
          <h2>Price history</h2>
        </div>
        <span className="chart-status">Comparable groups only</span>
      </div>
      <div className="price-history-grid">
        {chartGroups.map((group) => <ComparableChart key={group.label} label={group.label} sales={group.convertedSales} />)}
      </div>
      <p className="chart-note">Each chart keeps raw and graded sales separate. Amounts are converted into {currency} using European Central Bank reference rates from each sale date; the original price and currency remain visible in the sale record below.</p>
      <ThingsToKnow />
    </div>
  );
}
