type SalePoint = {
  sold_date: string | null;
  sale_price: number;
  currency: string;
  item_condition: string | null;
  grading_company: string | null;
  grade_label: string | null;
};

type PriceHistoryChartProps = {
  sales: SalePoint[];
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

function comparison(sale: SalePoint) {
  const grading = sale.grading_company || sale.grade_label
    ? `Graded${sale.grading_company ? ` · ${sale.grading_company}` : ""}${sale.grade_label ? ` ${sale.grade_label}` : ""}`
    : "Raw";
  const condition = sale.item_condition?.trim() || "Condition not recorded";
  return { currency: sale.currency, grading, condition, key: `${sale.currency}|${grading}|${condition}` };
}

function trendLabel(sales: Array<SalePoint & { sold_date: string }>) {
  const first = sales[0]?.sale_price;
  const last = sales.at(-1)?.sale_price;
  if (!first || !last) return "Insufficient history";
  const change = (last - first) / first;
  if (change >= 0.05) return "Rising";
  if (change <= -0.05) return "Falling";
  return "Stable";
}

function GhostChart({ comparableCount }: { comparableCount: number }) {
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
        <p>RAR needs {MIN_COMPARABLE_SALES} verified sales in the same currency, raw/graded state and condition group.{comparableCount ? ` This group currently has ${comparableCount}.` : ""}</p>
      </div>
    </div>
  );
}

function ComparableChart({ label, sales }: {
  label: ReturnType<typeof comparison>;
  sales: Array<SalePoint & { sold_date: string }>;
}) {
  const values = sales.map((sale) => sale.sale_price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(max * 0.1, 1);
  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const points = sales.map((sale, index) => ({
    x: PADDING_X + (index / (sales.length - 1)) * plotWidth,
    y: PADDING_TOP + ((max - sale.sale_price) / range) * plotHeight,
    sale,
  }));
  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
  const firstDate = sales[0].sold_date;
  const lastDate = sales.at(-1)?.sold_date;

  return (
    <article className="price-history-card comparable-chart-card">
      <div className="price-history-heading">
        <div>
          <p className="eyebrow">Comparable verified sales</p>
          <h2>{trendLabel(sales)}</h2>
        </div>
        <span className="chart-status">{sales.length} sales</span>
      </div>
      <p className="chart-comparable-label">{label.currency} · {label.grading} · {label.condition}</p>
      <div className="price-chart-wrap">
        <svg className="price-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`Price history from ${formatShortDate(firstDate)} to ${formatShortDate(lastDate ?? firstDate)}`}>
          <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP} y2={PADDING_TOP} />
          <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP + plotHeight / 2} y2={PADDING_TOP + plotHeight / 2} />
          <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP + plotHeight} y2={PADDING_TOP + plotHeight} />
          <polyline points={pointString} />
          {points.map((point) => <circle cx={point.x} cy={point.y} r="5" key={`${point.sale.sold_date}-${point.sale.sale_price}`} />)}
          <text x={PADDING_X} y={HEIGHT - 8}>{formatShortDate(firstDate)}</text>
          <text x={WIDTH - PADDING_X} y={HEIGHT - 8} textAnchor="end">{formatShortDate(lastDate ?? firstDate)}</text>
        </svg>
        <div className="chart-range" aria-hidden="true">
          <span>{label.currency} {max.toLocaleString("en-GB")}</span>
          <span>{label.currency} {min.toLocaleString("en-GB")}</span>
        </div>
      </div>
    </article>
  );
}

export default function PriceHistoryChart({ sales }: PriceHistoryChartProps) {
  const groups = new Map<string, { label: ReturnType<typeof comparison>; sales: Array<SalePoint & { sold_date: string }> }>();

  sales.filter((sale): sale is SalePoint & { sold_date: string } => Boolean(sale.sold_date)).forEach((sale) => {
    const label = comparison(sale);
    const group = groups.get(label.key) ?? { label, sales: [] };
    group.sales.push(sale);
    groups.set(label.key, group);
  });

  const comparableGroups = [...groups.values()]
    .map((group) => ({ ...group, sales: group.sales.sort((a, b) => a.sold_date.localeCompare(b.sold_date)) }))
    .sort((a, b) => b.sales.length - a.sales.length);
  const chartGroups = comparableGroups.filter((group) => group.sales.length >= MIN_COMPARABLE_SALES);
  const bestGroupCount = comparableGroups[0]?.sales.length ?? 0;

  if (!chartGroups.length) {
    return (
      <div className="price-history-card price-history-empty">
        <div className="price-history-heading">
          <div>
            <p className="eyebrow">RAR market history</p>
            <h2>Price history</h2>
          </div>
          <span className="chart-status">Illiquid / early data</span>
        </div>
        <GhostChart comparableCount={bestGroupCount} />
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
        {chartGroups.map((group) => <ComparableChart key={group.label.key} label={group.label} sales={group.sales} />)}
      </div>
      <p className="chart-note">Each trend keeps currency, raw/graded state and condition separate. RAR labels a group as rising or falling only after it has at least {MIN_COMPARABLE_SALES} verified comparable sales.</p>
    </div>
  );
}
