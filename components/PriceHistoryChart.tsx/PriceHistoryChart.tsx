type SalePoint = {
  sold_date: string | null;
  sale_price: number;
  currency: string;
};

type PriceHistoryChartProps = {
  sales: SalePoint[];
};

const WIDTH = 720;
const HEIGHT = 230;
const PADDING_X = 28;
const PADDING_TOP = 26;
const PADDING_BOTTOM = 34;

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export default function PriceHistoryChart({ sales }: PriceHistoryChartProps) {
  const datedSales = sales
    .filter((sale): sale is SalePoint & { sold_date: string } => Boolean(sale.sold_date))
    .sort((a, b) => a.sold_date.localeCompare(b.sold_date));

  const currency = datedSales.at(-1)?.currency;
  const sameCurrencySales = currency
    ? datedSales.filter((sale) => sale.currency === currency)
    : [];
  const canDrawChart = sameCurrencySales.length >= 2;

  if (!canDrawChart) {
    return (
      <div className="price-history-card price-history-empty">
        <div className="price-history-heading">
          <div>
            <p className="eyebrow">RAR market history</p>
            <h2>Price history</h2>
          </div>
          <span className="chart-status">Building history</span>
        </div>
        <div className="ghost-chart" aria-label="Price history is not yet available">
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-hidden="true">
            <line x1="0" x2={WIDTH} y1="54" y2="54" />
            <line x1="0" x2={WIDTH} y1="115" y2="115" />
            <line x1="0" x2={WIDTH} y1="176" y2="176" />
            <path d="M 0 158 C 100 127, 150 156, 240 120 S 380 94, 470 132 S 600 84, 720 102" />
          </svg>
          <div className="ghost-chart-message">
            <strong>Not enough verified sales yet</strong>
            <p>RAR needs at least two confirmed sales of this exact edition before it draws a price trend.</p>
          </div>
        </div>
      </div>
    );
  }

  const values = sameCurrencySales.map((sale) => sale.sale_price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || Math.max(max * 0.1, 1);
  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const points = sameCurrencySales.map((sale, index) => {
    const x = PADDING_X + (index / (sameCurrencySales.length - 1)) * plotWidth;
    const y = PADDING_TOP + ((max - sale.sale_price) / range) * plotHeight;
    return { x, y, sale };
  });
  const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
  const firstDate = sameCurrencySales[0].sold_date;
  const lastDate = sameCurrencySales.at(-1)?.sold_date;

  return (
    <div className="price-history-card">
      <div className="price-history-heading">
        <div>
          <p className="eyebrow">RAR market history</p>
          <h2>Price history</h2>
        </div>
        <span className="chart-status">{sameCurrencySales.length} verified sales</span>
      </div>
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
          <span>{currency} {max.toLocaleString("en-GB")}</span>
          <span>{currency} {min.toLocaleString("en-GB")}</span>
        </div>
      </div>
      <p className="chart-note">Trend uses only sales verified to match this exact edition. Condition, currency and grading will become separate filters as the database grows.</p>
    </div>
  );
}
