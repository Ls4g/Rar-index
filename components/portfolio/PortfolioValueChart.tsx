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

type PortfolioValueChartProps = {
  snapshots: PortfolioSnapshotPoint[];
  currency: DisplayCurrency;
  // Written to sit inside a sentence -- "the last 3 months". A change figure
  // without the window it covers is not information, so the two are always
  // rendered together.
  rangePhrase: string;
};

const WIDTH = 760;
const HEIGHT = 280;
const PADDING_LEFT = 16;
const PADDING_RIGHT = 24;
const PADDING_TOP = 24;
const PADDING_BOTTOM = 40;

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

// Several snapshots on one day are normal (adding a holding records one
// immediately), and axis ends both reading "9 Aug 2026" looks broken. Fall
// back to clock time whenever the whole range sits inside a single day.
function formatAxisLabel(value: string, sameDay: boolean) {
  if (!sameDay) return formatSnapshotDate(value);
  return new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

// A snapshot recorded because the user changed what they own: the value
// moved because the portfolio's contents changed, not because the market
// did. Stated in the tooltip so a jump is never silently read as a gain.
const CONTRIBUTION_REASONS = new Set<string>(["holding_added", "holding_updated", "holding_removed"]);

function contributionLabel(reason: SnapshotTriggerReason | null | undefined) {
  if (reason === "holding_added") return "You added a holding";
  if (reason === "holding_removed") return "You removed a holding";
  if (reason === "holding_updated") return "You edited a holding";
  return null;
}

function EmptyState() {
  return (
    <div className="portfolio-chart-empty" role="status">
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
      <p><strong>No snapshots recorded in {currency} yet.</strong> Snapshots are stored in the currency selected when they were taken. Switch display currency to see your history.</p>
    </div>
  );
}

// A single real data point is never drawn as a line — that would imply a
// trend from one measurement. It is shown as a plain figure instead.
function SinglePointState({ snapshot, currency }: { snapshot: PortfolioSnapshotPoint; currency: DisplayCurrency }) {
  return (
    <div className="portfolio-chart-single">
      <strong>{snapshot.total_evidence_value !== null ? formatPrice(snapshot.total_evidence_value, currency) : "Still being researched"}</strong>
      <p className="portfolio-chart-single-date">Recorded {formatSnapshotDate(snapshot.snapshot_at)}</p>
      <p>One snapshot recorded so far. A line appears once RAR has a second one to compare against.</p>
    </div>
  );
}

export default function PortfolioValueChart({ snapshots, currency, rangePhrase }: PortfolioValueChartProps) {
  const inRangeCurrency = snapshots.filter((snapshot) => snapshot.display_currency === currency);
  const ordered = [...inRangeCurrency].sort((a, b) => a.snapshot_at.localeCompare(b.snapshot_at));
  // One line: the portfolio's market value over time. What was paid is a
  // fixed figure, not a movement, and is already reported as a number in
  // the summary above — plotting it here only ever competed with the line
  // this chart exists to show.
  const valued = ordered.filter((snapshot) => snapshot.total_evidence_value !== null);

  // Null means "not being pointed at", which always resolves to the latest
  // snapshot. Seeding state with a length-derived index instead went stale:
  // the first render happens before snapshots load, so the index stuck at
  // the value computed from an empty list.
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (!snapshots.length) return <EmptyState />;
  if (!ordered.length) return <CurrencyMismatch currency={currency} />;
  if (valued.length === 1) return <SinglePointState snapshot={valued[0]} currency={currency} />;
  if (!valued.length) return <SinglePointState snapshot={ordered[ordered.length - 1]} currency={currency} />;

  const activeIdx = hoverIndex === null ? valued.length - 1 : Math.min(Math.max(hoverIndex, 0), valued.length - 1);
  const activePoint = valued[activeIdx];
  const values = valued.map((point) => point.total_evidence_value as number);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // Padded around the real range rather than forced to zero, so genuine
  // movement is visible rather than pressed flat against the top of the
  // plot. Both ends are labelled, so the scale is never implied.
  const span = rawMax - rawMin || Math.max(rawMax * 0.02, 1);
  const min = rawMin - span * 0.25;
  const max = rawMax + span * 0.25;
  const plotWidth = WIDTH - PADDING_LEFT - PADDING_RIGHT;
  const plotHeight = HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const baselineY = PADDING_TOP + plotHeight;
  const xFor = (index: number) => PADDING_LEFT + (valued.length === 1 ? 0 : (index / (valued.length - 1)) * plotWidth);
  const yFor = (value: number) => PADDING_TOP + ((max - value) / (max - min)) * plotHeight;

  const linePath = valued.map((point, index) => `${index ? "L" : "M"} ${xFor(index)} ${yFor(point.total_evidence_value as number)}`).join(" ");
  const sameDayRange = valued[0].snapshot_at.slice(0, 10) === valued[valued.length - 1].snapshot_at.slice(0, 10);

  function updateActiveFromClientX(clientX: number, wrap: HTMLDivElement) {
    const rect = wrap.getBoundingClientRect();
    if (!rect.width) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const svgX = ratio * WIDTH;
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    valued.forEach((_, index) => {
      const distance = Math.abs(xFor(index) - svgX);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
    });
    setHoverIndex(nearestIndex);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "touch") return;
    updateActiveFromClientX(event.clientX, event.currentTarget);
  }
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    updateActiveFromClientX(event.clientX, event.currentTarget);
  }
  function handlePointerLeave() {
    setHoverIndex(null);
  }
  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = hoverIndex === null ? valued.length - 1 : hoverIndex;
    if (event.key === "ArrowRight") { event.preventDefault(); setHoverIndex(Math.min(valued.length - 1, current + 1)); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); setHoverIndex(Math.max(0, current - 1)); }
    else if (event.key === "Home") { event.preventDefault(); setHoverIndex(0); }
    else if (event.key === "End") { event.preventDefault(); setHoverIndex(valued.length - 1); }
  }

  const firstValue = valued[0].total_evidence_value as number;
  const lastValue = valued[valued.length - 1].total_evidence_value as number;
  const changeAmount = lastValue - firstValue;
  // A percentage off a zero starting value is not meaningful, so the amount
  // stands alone in that case rather than reporting an infinite gain.
  const rangeChange = changeAmount === 0 ? null : {
    amount: changeAmount,
    percent: firstValue > 0 ? (changeAmount / firstValue) * 100 : null,
  };

  const activeX = xFor(activeIdx);
  const activeY = yFor(activePoint.total_evidence_value as number);
  const tooltipLeft = Math.min(86, Math.max(14, (activeX / WIDTH) * 100));
  const tooltipTop = (activeY / HEIGHT) * 100;
  const tooltipBelow = tooltipTop < 34;
  const contribution = activePoint.trigger_reason && CONTRIBUTION_REASONS.has(activePoint.trigger_reason)
    ? contributionLabel(activePoint.trigger_reason)
    : null;

  return (
    <div className="portfolio-value-chart">
      <div className="portfolio-chart-heading">
        <span className="portfolio-chart-legend">Market value</span>
        <span className="portfolio-chart-range">{rangePhrase} · shown in {currency}</span>
      </div>
      {/* The movement across the window actually being shown -- first
          recorded snapshot in range against the last. This is a market
          movement, not gain against what was paid; that comparison lives in
          the summary above and is deliberately worded differently. */}
      {rangeChange ? (
        <p className={`portfolio-chart-change ${rangeChange.amount >= 0 ? "is-positive" : "is-negative"}`}>
          <strong>{rangeChange.amount >= 0 ? "+" : "−"}{formatPrice(Math.abs(rangeChange.amount), currency)}</strong>
          {rangeChange.percent !== null ? <span>({rangeChange.amount >= 0 ? "+" : "−"}{Math.abs(rangeChange.percent).toFixed(1)}%)</span> : null}
          <em>over {rangePhrase}</em>
        </p>
      ) : null}
      <div
        className="portfolio-chart-wrap"
        tabIndex={0}
        role="group"
        aria-label={`Portfolio market value from ${formatSnapshotDate(valued[0].snapshot_at)} to ${formatSnapshotDate(valued[valued.length - 1].snapshot_at)}. Use the left and right arrow keys to move between snapshots.`}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
      >
        <svg className="portfolio-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-hidden="true">
          <line className="portfolio-chart-axis" x1={PADDING_LEFT} x2={PADDING_LEFT} y1={PADDING_TOP - 8} y2={baselineY} />
          <line className="portfolio-chart-axis" x1={PADDING_LEFT} x2={WIDTH - PADDING_RIGHT} y1={baselineY} y2={baselineY} />
          <path d={linePath} className="portfolio-chart-line" fill="none" />
          <line className="portfolio-chart-active-guide" x1={activeX} x2={activeX} y1={PADDING_TOP} y2={baselineY} />
          <circle className="portfolio-chart-point is-active" cx={activeX} cy={activeY} r={5} />
          <text className="portfolio-chart-axis-value" x={PADDING_LEFT + 6} y={yFor(rawMax) - 8}>{formatPrice(rawMax, currency)}</text>
          <text className="portfolio-chart-axis-value" x={PADDING_LEFT + 6} y={yFor(rawMin) + 16}>{formatPrice(rawMin, currency)}</text>
          <text x={PADDING_LEFT} y={HEIGHT - 12}>{formatAxisLabel(valued[0].snapshot_at, sameDayRange)}</text>
          {sameDayRange ? <text x={WIDTH / 2} y={HEIGHT - 12} textAnchor="middle">{formatSnapshotDate(valued[0].snapshot_at)}</text> : null}
          <text x={WIDTH - PADDING_RIGHT} y={HEIGHT - 12} textAnchor="end">{formatAxisLabel(valued[valued.length - 1].snapshot_at, sameDayRange)}</text>
        </svg>
        <div className={`portfolio-chart-tooltip${tooltipBelow ? " is-below" : ""}`} style={{ left: `${tooltipLeft}%`, top: `${tooltipTop}%` }} aria-hidden="true">
          <strong>{formatPrice(activePoint.total_evidence_value as number, currency)}</strong>
          <span>{formatSnapshotDate(activePoint.snapshot_at)}</span>
          {contribution ? <span className="is-contribution">{contribution}</span> : null}
        </div>
      </div>
      <p className="portfolio-chart-active-summary" aria-live="polite">
        {formatSnapshotDate(activePoint.snapshot_at)} · {formatPrice(activePoint.total_evidence_value as number, currency)}
        {contribution ? ` · ${contribution}` : ""}
        {activePoint.holdings_unvalued_count ? ` · ${activePoint.holdings_unvalued_count} holding${activePoint.holdings_unvalued_count === 1 ? "" : "s"} awaiting evidence` : ""}
      </p>
    </div>
  );
}
