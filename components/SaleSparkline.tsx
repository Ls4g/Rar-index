export type SalePoint = { date: string; price: number; currency: string; graded: boolean };

// Steep's rule, taken almost whole: "no axes, no gridlines -- the chart is a
// gestural line, not a data dashboard." RAR's current chart draws a grid, a
// y-axis and a legend around five data points, which is dashboard furniture
// pretending five sales are a trend.
//
// Where RAR must diverge: it is an evidence product, so every point is a real
// verified sale and is drawn as one. Sparseness is shown rather than smoothed
// -- the line is straight between sales because RAR does not know what
// happened in between, and pretending otherwise with a curve would be a claim
// it cannot support.
export default function SaleSparkline({
  points, width = 560, height = 132, accent = "var(--rr-accent)",
}: { points: SalePoint[]; width?: number; height?: number; accent?: string }) {
  if (points.length < 2) return null;

  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || max || 1;
  const padY = 18;
  const padX = 10;

  const times = points.map((point) => new Date(point.date).getTime());
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const timeSpan = lastTime - firstTime || 1;

  // Positioned by actual date, not by index. Evenly spacing five sales that
  // happened across five very uneven months would draw a rhythm the market
  // never had.
  const coords = points.map((point) => ({
    ...point,
    x: padX + ((new Date(point.date).getTime() - firstTime) / timeSpan) * (width - padX * 2),
    y: height - padY - ((point.price - min) / span) * (height - padY * 2),
  }));

  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`;

  return (
    <svg className="rr-spark" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${points.length} verified sales from ${points[0].date} to ${points[points.length - 1].date}`}>
      <defs>
        <linearGradient id="rr-spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.16" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rr-spark-fill)" />
      <path d={line} fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {coords.map((point) => (
        // A graded sale is a hollow ring, a raw sale is solid. Raw and graded
        // are different markets and RAR keeps them apart everywhere else, so
        // the chart must not quietly merge them into one line's worth of
        // meaning.
        <circle
          cx={point.x}
          cy={point.y}
          fill={point.graded ? "var(--rr-surface)" : accent}
          key={`${point.date}-${point.price}`}
          r={point.graded ? 3.4 : 2.8}
          stroke={accent}
          strokeWidth={point.graded ? 1.4 : 0}
        >
          <title>{`${point.currency} ${point.price} · ${point.date}${point.graded ? " · graded" : " · raw"}`}</title>
        </circle>
      ))}
    </svg>
  );
}
