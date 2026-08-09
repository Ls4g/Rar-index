"use client";

import { useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { formatPrice, type DisplayCurrency } from "@/lib/fx";

export type SnapshotTriggerReason =
  | "holding_added"
  | "holding_updated"
  | "holding_removed"
  | "evidence_changed"
  | "daily_cron";

export type PortfolioSnapshotPoint = {
  id: string;
  snapshot_at: string;
  display_currency: DisplayCurrency;
  total_paid: number | null;
  total_evidence_value: number | null;
  gain_loss_amount: number | null;
  gain_loss_percent: number | null;
  holdings_valued_count: number;
  holdings_unvalued_count: number;
  // Null on snapshots recorded before automatic triggers existed -- treated
  // as "not a known contribution", never guessed at retrospectively.
  trigger_reason?: SnapshotTriggerReason | null;
};

// A snapshot recorded because the user changed what they own. The value
// moved because the portfolio's contents changed, not because the market
// did -- the distinction a real portfolio tool draws between a deposit and
// a gain, and the reason these points are marked rather than blended into
// the trend line.
const CONTRIBUTION_REASONS = new Set<string>(["holding_added", "holding_updated", "holding_removed"]);

function isContribution(point: PortfolioSnapshotPoint) {
  return point.trigger_reason ? CONTRIBUTION_REASONS.has(point.trigger_reason) : false;
}

function contributionLabel(reason: SnapshotTriggerReason | null | undefined) {
  if (reason === "holding_added") return "You added a holding";
  if (reason === "holding_removed") return "You removed a holding";
  if (reason === "holding_updated") return "You edited a holding";
  return null;
}

type PortfolioValueChartProps = {
  snapshots: PortfolioSnapshotPoint[];
  currency: DisplayCurrency;
  rangeLabel: string;
};

const WIDTH = 760;
const HEIGHT = 340;
const PADDING_X = 32;
const PADDING_TOP = 36;
const PADDING_BOTTOM = 54;

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function EmptyState() {
  return (
    <div className="portfolio-chart-empty" role="status">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-hidden="true" className="portfolio-chart-ghost">
        <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={HEIGHT * 0.32} y2={HEIGHT * 0.32} />
        <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={HEIGHT * 0.58} y2={HEIGHT * 0.58} />
        <line x1={PADDING_X} x2={WIDTH - PADDING_X} y1={HEIGHT * 0.84} y2={HEIGHT * 0.84} />
        <circle cx={WIDTH * 0.5} cy={HEIGHT * 0.58} r="6" />
      </svg>
      <div className="portfolio-chart-empty-message">
        <p><strong>Portfolio tracking starts today.</strong> RAR will build history from verified evidence over time.</p>
        <p>Nothing here is estimated or backdated. The first point appears the moment a real snapshot is recorded.</p>
      </div>
    </div>
  );
}

function CurrencyMismatch({ currency }: { currency: DisplayCurrency }) {
  return (
    <div className="portfolio-chart-empty" role="status">
      <p><strong>No snapshots recorded in {currency} yet.</strong> Snapshots are stored in the currency selected when they were taken. Switch display currency, or take a new snapshot in {currency}.</p>
    </div>
  );
}

// A single real data point is never drawn as a line — that would imply a
// trend from one measurement. It is shown as a plain figure instead.
function SinglePointState({ snapshot, currency }: { snapshot: PortfolioSnapshotPoint; currency: DisplayCurrency }) {
  return (
    <div className="portfolio-chart-single">
      <div className="portfolio-chart-single-figures">
        <div>
          <span>RAR evidence value</span>
          <strong>{snapshot.total_evidence_value !== null ? formatPrice(snapshot.total_evidence_value, currency) : "Still being researched"}</strong>
        </div>
        <div>
          <span>Total paid</span>
          <strong>{snapshot.total_paid !== null ? formatPrice(snapshot.total_paid, currency) : "Not recorded"}</strong>
        </div>
      </div>
      <p className="portfolio-chart-single-date">Recorded {formatSnapshotDate(snapshot.snapshot_at)}</p>
      <p>One snapshot recorded so far. A trend will appear once RAR has taken more snapshots to compare against.</p>
    </div>
  );
}

export default function PortfolioValueChart({ snapshots, currency, rangeLabel }: PortfolioValueChartProps) {
  const inRangeCurrency = snapshots.filter((snapshot) => snapshot.display_currency === currency);
  const ordered = [...inRangeCurrency].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));

  const [activeIndex, setActiveIndex] = useState(ordered.length - 1);
  const activePoint = ordered[Math.min(Math.max(activeIndex, 0), ordered.length - 1)];

  if (!snapshots.length) return <EmptyState />;
  if (!ordered.length) return <CurrencyMismatch currency={currency} />;
  if (ordered.length === 1) return <SinglePointState snapshot={ordered[0]} currency={currency} />;

  const values = ordered.flatMap((point) => [point.total_paid, point.total_evidence_value]).filter((value): value is number => value !== null);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 0.01);
  const range = max - min || 1;
  const plotWidth = WIDTH - PADDING_X * 2;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const baselineY = PADDING_TOP + plotHeight;
  const xFor = (index: number) => PADDING_X + (ordered.length === 1 ? 0 : (index / (ordered.length - 1)) * plotWidth);
  const yFor = (value: number) => PADDING_TOP + ((max - value) / range) * plotHeight;

  const evidencePoints = ordered.map((point, index) => ({ index, x: xFor(index), value: point.total_evidence_value }));
  const paidPoints = ordered.map((point, index) => ({ index, x: xFor(index), value: point.total_paid }));

  function pathFor(points: Array<{ x: number; value: number | null }>) {
    const segments: string[] = [];
    let drawing = false;
    for (const point of points) {
      if (point.value === null) { drawing = false; continue; }
      const y = yFor(point.value);
      segments.push(`${drawing ? "L" : "M"} ${point.x} ${y}`);
      drawing = true;
    }
    return segments.join(" ");
  }

  // The filled band between the two lines only ever covers stretches where
  // both a paid and an evidence figure exist for the same snapshot — never
  // interpolated across a gap, and never drawn as "gain" or "loss" from a
  // single-sided figure.
  const bandSegments: Array<{ points: string; isGain: boolean }> = [];
  let current: Array<{ x: number; paidY: number; evidenceY: number }> = [];
  function flushBand() {
    if (current.length < 2) { current = []; return; }
    const isGain = current.reduce((sum, point) => sum + (point.evidenceY <= point.paidY ? 1 : 0), 0) >= current.length / 2;
    const top = current.map((point) => `${point.x},${Math.min(point.paidY, point.evidenceY)}`).join(" L ");
    const bottom = [...current].reverse().map((point) => `${point.x},${Math.max(point.paidY, point.evidenceY)}`).join(" L ");
    bandSegments.push({ points: `M ${top} L ${bottom} Z`, isGain });
    current = [];
  }
  ordered.forEach((point, index) => {
    if (point.total_paid === null || point.total_evidence_value === null) { flushBand(); return; }
    current.push({ x: xFor(index), paidY: yFor(point.total_paid), evidenceY: yFor(point.total_evidence_value) });
  });
  flushBand();

  const evidencePath = pathFor(evidencePoints);
  const paidPath = pathFor(paidPoints);
  const hasAnyEvidence = evidencePoints.some((point) => point.value !== null);
  const hasAnyPaid = paidPoints.some((point) => point.value !== null);

  function updateActiveFromClientX(clientX: number, wrap: HTMLDivElement) {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const svgX = ratio * WIDTH;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    ordered.forEach((_, index) => {
      const distance = Math.abs(xFor(index) - svgX);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
    });
    setActiveIndex(nearestIndex);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    updateActiveFromClientX(event.clientX, event.currentTarget);
  }
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    updateActiveFromClientX(event.clientX, event.currentTarget);
  }
  function handlePointerLeave() {
    setActiveIndex(ordered.length - 1);
  }
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); setActiveIndex((current) => Math.min(ordered.length - 1, current + 1)); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setActiveIndex(0); }
    else if (event.key === "End") { event.preventDefault(); setActiveIndex(ordered.length - 1); }
  }

  const activeX = xFor(Math.min(activeIndex, ordered.length - 1));
  const tooltipLeft = Math.min(88, Math.max(12, (activeX / WIDTH) * 100));
  const activeEvidenceY = activePoint.total_evidence_value !== null ? yFor(activePoint.total_evidence_value) : null;
  const tooltipTop = activeEvidenceY !== null ? (activeEvidenceY / HEIGHT) * 100 : 50;

  return (
    <div className="portfolio-value-chart">
      <div className="portfolio-chart-heading">
        <span className="portfolio-chart-legend">
          <i className="portfolio-chart-legend-swatch is-evidence" aria-hidden="true" /> RAR evidence value
          <i className="portfolio-chart-legend-swatch is-paid" aria-hidden="true" /> Total paid
          {ordered.some(isContribution) ? <><i className="portfolio-chart-legend-swatch is-contribution" aria-hidden="true" /> You changed a holding</> : null}
        </span>
        <span className="portfolio-chart-range">{rangeLabel} · shown in {currency}</span>
      </div>
      <div
        className="portfolio-chart-wrap"
        tabIndex={0}
        role="group"
        aria-label={`Portfolio value from ${formatSnapshotDate(ordered[0].snapshot_at)} to ${formatSnapshotDate(ordered.at(-1)!.snapshot_at)}. Use the left and right arrow keys to move between snapshots.`}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
      >
        <svg className="portfolio-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-hidden="true">
          <line className="portfolio-chart-grid" x1={PADDING_X} x2={WIDTH - PADDING_X} y1={PADDING_TOP} y2={PADDING_TOP} />
          <line className="portfolio-chart-grid" x1={PADDING_X} x2={WIDTH - PADDING_X} y1={baselineY} y2={baselineY} />
          {bandSegments.map((segment, index) => (
            <path key={index} d={segment.points} className={`portfolio-chart-band ${segment.isGain ? "is-gain" : "is-loss"}`} />
          ))}
          {hasAnyPaid ? <path d={paidPath} className="portfolio-chart-line is-paid" fill="none" /> : null}
          {hasAnyEvidence ? <path d={evidencePath} className="portfolio-chart-line is-evidence" fill="none" /> : null}
          <line className="portfolio-chart-active-guide" x1={activeX} x2={activeX} y1={PADDING_TOP} y2={baselineY} />
          {/* Contribution markers sit on the baseline rather than on either
              line: the change they caused belongs to the whole portfolio, not
              to one series, and anchoring them to a value would imply the
              market moved to that figure. */}
          {ordered.map((point, index) => isContribution(point) ? (
            <line
              key={`c-${point.id}`}
              className={`portfolio-chart-contribution${index === activeIndex ? " is-active" : ""}`}
              x1={xFor(index)}
              x2={xFor(index)}
              y1={baselineY - 9}
              y2={baselineY}
            />
          ) : null)}
          {evidencePoints.map((point) => point.value === null ? null : (
            <circle key={`e-${ordered[point.index].id}`} className={`portfolio-chart-point is-evidence${point.index === activeIndex ? " is-active" : ""}`} cx={point.x} cy={yFor(point.value)} r={point.index === activeIndex ? 6 : 3} />
          ))}
          {paidPoints.map((point) => point.value === null ? null : (
            <circle key={`p-${ordered[point.index].id}`} className={`portfolio-chart-point is-paid${point.index === activeIndex ? " is-active" : ""}`} cx={point.x} cy={yFor(point.value)} r={point.index === activeIndex ? 5 : 2.5} />
          ))}
          <text x={PADDING_X} y={HEIGHT - 10}>{formatSnapshotDate(ordered[0].snapshot_at)}</text>
          <text x={WIDTH - PADDING_X} y={HEIGHT - 10} textAnchor="end">{formatSnapshotDate(ordered.at(-1)!.snapshot_at)}</text>
        </svg>
        <div className="portfolio-chart-tooltip" style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }} aria-hidden="true">
          <strong>{activePoint.total_evidence_value !== null ? formatPrice(activePoint.total_evidence_value, currency) : "No evidence value yet"}</strong>
          <span>{formatSnapshotDate(activePoint.snapshot_at)}</span>
          {activePoint.total_paid !== null ? <span>Paid {formatPrice(activePoint.total_paid, currency)}</span> : null}
          {/* Shown before any gain figure: a move into this point caused by
              the user changing what they own must not read as the market
              having moved. */}
          {isContribution(activePoint) ? <span className="is-contribution">{contributionLabel(activePoint.trigger_reason)}</span> : null}
          {activePoint.gain_loss_amount !== null ? (
            <span className={activePoint.gain_loss_amount >= 0 ? "is-positive" : "is-negative"}>
              {activePoint.gain_loss_amount >= 0 ? "+" : ""}{formatPrice(activePoint.gain_loss_amount, currency)}
              {activePoint.gain_loss_percent !== null ? ` (${activePoint.gain_loss_percent >= 0 ? "+" : ""}${activePoint.gain_loss_percent.toFixed(1)}%)` : ""}
              {" vs paid"}
            </span>
          ) : null}
        </div>
      </div>
      <p className="portfolio-chart-active-summary" aria-live="polite">
        {formatSnapshotDate(activePoint.snapshot_at)} · {activePoint.total_evidence_value !== null ? formatPrice(activePoint.total_evidence_value, currency) : "No evidence value yet"}
        {activePoint.total_paid !== null ? ` · paid ${formatPrice(activePoint.total_paid, currency)}` : ""}
        {isContribution(activePoint) ? ` · ${contributionLabel(activePoint.trigger_reason)}` : ""}
        {" · "}{activePoint.holdings_valued_count} holding{activePoint.holdings_valued_count === 1 ? "" : "s"} valued
        {activePoint.holdings_unvalued_count ? `, ${activePoint.holdings_unvalued_count} awaiting evidence` : ""}
      </p>
    </div>
  );
}
