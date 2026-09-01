"use client";

import { useState } from "react";
import { useMarketCurrency } from "@/components/MarketCurrencyProvider";
import { convertSale, formatPrice, type FxRate } from "@/lib/fx";

export type SalePoint = { date: string; price: number; currency: string; graded: boolean };

function formatPointDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function SaleSparkline({
  points,
  rates,
  width = 560,
  height = 166,
  accent = "var(--accent-label-text)",
}: {
  points: SalePoint[];
  rates: FxRate[];
  width?: number;
  height?: number;
  accent?: string;
}) {
  const { currency } = useMarketCurrency();
  const [activeIndex, setActiveIndex] = useState(points.length - 1);

  if (points.length < 2) return null;

  const displayPoints = points.map((point) => {
    const converted = convertSale({
      sale_price: point.price,
      currency: point.currency,
      sold_date: point.date,
      grading_company: point.graded ? "Graded" : null,
      grade_label: null,
    }, currency, rates);

    return {
      ...point,
      displayCurrency: converted?.display_currency ?? point.currency,
      displayPrice: converted?.converted_price ?? point.price,
    };
  });

  const prices = displayPoints.map((point) => point.displayPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || max || 1;
  const padY = 34;
  const padX = 30;

  const times = displayPoints.map((point) => new Date(point.date).getTime());
  const firstTime = Math.min(...times);
  const lastTime = Math.max(...times);
  const timeSpan = lastTime - firstTime || 1;

  const coords = displayPoints.map((point) => ({
    ...point,
    x: padX + ((new Date(point.date).getTime() - firstTime) / timeSpan) * (width - padX * 2),
    y: height - padY - ((point.displayPrice - min) / span) * (height - padY * 2),
  }));

  const safeActiveIndex = Math.min(Math.max(activeIndex, 0), coords.length - 1);
  const active = coords[safeActiveIndex];
  const line = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = `${line} L ${coords[coords.length - 1].x.toFixed(1)} ${height} L ${coords[0].x.toFixed(1)} ${height} Z`;

  return (
    <div className="sale-spark-shell">
      <div className="sale-spark-readout" aria-live="polite">
        <span>{formatPointDate(active.date)}</span>
        <strong>{formatPrice(active.displayPrice, active.displayCurrency)}</strong>
        <em>Verified {active.graded ? "graded" : "raw"} sale</em>
      </div>
      <svg
        className="sale-spark"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${points.length} verified sales. Select a point to read its price and date.`}
      >
        <defs>
          <linearGradient id="rr-spark-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.16" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#rr-spark-fill)" />
        <path d={line} fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((point, index) => {
          const isActive = index === safeActiveIndex;
          const labelY = point.y < 54 ? point.y + 19 : point.y - 12;
          const textAnchor = point.x < 62 ? "start" : point.x > width - 62 ? "end" : "middle";
          return (
            <g
              className={`sale-spark-point${isActive ? " is-active" : ""}`}
              key={`${point.date}-${point.price}-${index}`}
              role="button"
              tabIndex={0}
              aria-label={`${formatPointDate(point.date)}, ${formatPrice(point.displayPrice, point.displayCurrency)}, verified ${point.graded ? "graded" : "raw"} sale`}
              onClick={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onPointerEnter={() => setActiveIndex(index)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveIndex(index);
                }
              }}
            >
              <circle className="sale-spark-hit" cx={point.x} cy={point.y} r="13" />
              <circle
                cx={point.x}
                cy={point.y}
                fill={point.graded ? "var(--surface-card)" : accent}
                r={isActive ? 4.8 : point.graded ? 3.4 : 2.8}
                stroke={accent}
                strokeWidth={point.graded || isActive ? 1.5 : 0}
              />
              <text
                className="sale-spark-price-label"
                x={point.x}
                y={labelY}
                textAnchor={textAnchor}
              >
                {formatPrice(point.displayPrice, point.displayCurrency)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="sale-spark-dates" aria-hidden="true">
        <span>{formatPointDate(coords[0].date)}</span>
        <span>{formatPointDate(coords[coords.length - 1].date)}</span>
      </div>
      <div className="sale-spark-mobile-points" aria-label="Verified sales on this chart">
        {coords.map((point, index) => (
          <button
            className={index === safeActiveIndex ? "is-active" : undefined}
            key={`${point.date}-${point.price}-mobile-${index}`}
            type="button"
            onClick={() => setActiveIndex(index)}
          >
            <span>{formatPointDate(point.date)}</span>
            <strong>{formatPrice(point.displayPrice, point.displayCurrency)}</strong>
          </button>
        ))}
      </div>
    </div>
  );
}
