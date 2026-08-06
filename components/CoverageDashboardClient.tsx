"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { editionDescriptor, publisherDisplayName } from "@/lib/editionDisplay";

export type CoverageRow = {
  editionId: string;
  title: string | null;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  isbn13: string | null;
  publisher: string | null;
  printingNumber: number | null;
  editionStatement: string | null;
  variantName: string | null;
  collectibleType: string | null;
  coverStatus: "missing" | "candidate" | "verified" | "rejected";
  printingOfEditionId: string | null;
  verifiedSaleCount: number;
  reviewSaleCount: number;
  comparableSaleCount: number;
  profileId: string | null;
  pendingLeadCount: number;
};

type SaleRange = "all" | "zero" | "one_two" | "three_plus";
type ProfileFilter = "all" | "has" | "missing";

// Pricing coverage sprint (2026-08): these 9 series' Vol. 1 editions are the
// current operational focus for closing sales-evidence and cover gaps.
// Matched case-insensitively since the catalogue has a known casing
// inconsistency ("One Piece" vs "ONE PIECE") on one series.
const TARGET_SPRINT_SERIES = [
  "One Piece",
  "Hunter",
  "Jujutsu Kaisen",
  "Kagurabachi",
  "Naruto",
  "Bleach",
  "Demon Slayer",
  "Attack on Titan",
  "Initial D",
];

function isTargetSprintRow(row: CoverageRow) {
  if (row.volumeNumber !== "1") return false;
  const series = (row.series ?? "").toLocaleLowerCase();
  return TARGET_SPRINT_SERIES.some((target) => series.includes(target.toLocaleLowerCase()));
}

const coverLabels: Record<CoverageRow["coverStatus"], string> = {
  missing: "Cover pending",
  candidate: "Cover under review",
  rejected: "Cover not confirmed",
  verified: "Verified cover",
};

function coverToneClass(status: CoverageRow["coverStatus"]) {
  if (status === "verified") return "coverage-good";
  if (status === "candidate") return "coverage-neutral";
  return "coverage-warning";
}

function primaryAction(row: CoverageRow) {
  if (row.pendingLeadCount > 0) {
    return { href: "/scout", label: `Review ${row.pendingLeadCount} Scout lead${row.pendingLeadCount === 1 ? "" : "s"}`, tone: "coverage-urgent" };
  }
  if (row.reviewSaleCount > 0) {
    return { href: "/review", label: `Review ${row.reviewSaleCount} pending sale${row.reviewSaleCount === 1 ? "" : "s"}`, tone: "coverage-urgent" };
  }
  if (row.verifiedSaleCount === 0) {
    return row.profileId
      ? { href: `/collection-profiles/${row.profileId}`, label: "Check for sales", tone: "coverage-warning" }
      : { href: `/collection-profiles/new?editionId=${row.editionId}`, label: "Create collection profile", tone: "coverage-warning" };
  }
  if (row.coverStatus !== "verified") return { href: `/cover-review?edition=${row.editionId}`, label: "Source a cover", tone: "coverage-warning" };
  if (row.comparableSaleCount < 3) return { href: `/price-import?editionId=${row.editionId}`, label: "Add sale evidence", tone: "coverage-neutral" };
  return { href: `/edition/${row.editionId}`, label: "View edition", tone: "coverage-good" };
}

function RowActions({ row }: { row: CoverageRow }) {
  return (
    <div className="coverage-row-actions">
      <Link className="staff-action-link" href={`/edition/${row.editionId}`}>Edition -&gt;</Link>
      {row.profileId
        ? <Link className="staff-action-link" href={`/collection-profiles/${row.profileId}`}>Profile -&gt;</Link>
        : <Link className="staff-action-link" href={`/collection-profiles/new?editionId=${row.editionId}`}>New profile -&gt;</Link>}
      {row.pendingLeadCount > 0 ? <Link className="staff-action-link" href="/scout">Scout leads -&gt;</Link> : null}
      {row.reviewSaleCount > 0 ? <Link className="staff-action-link" href="/review">Review sales -&gt;</Link> : null}
      {row.coverStatus === "candidate" || row.coverStatus === "rejected" ? <Link className="staff-action-link" href={`/cover-review?edition=${row.editionId}`}>Cover review -&gt;</Link> : null}
      <Link className="staff-action-link" href={`/price-import?editionId=${row.editionId}`}>Price import -&gt;</Link>
    </div>
  );
}

function RowIdentity({ row }: { row: CoverageRow }) {
  return (
    <div className="coverage-row-identity">
      <Link href={`/edition/${row.editionId}`}><strong>{row.title ?? "Untitled edition"}</strong></Link>
      <small>{[row.series, row.volumeNumber ? `Vol. ${row.volumeNumber}` : null, row.language, publisherDisplayName(row.publisher)].filter(Boolean).join(" · ")}</small>
      <small>{editionDescriptor({ edition_statement: row.editionStatement, printing_number: row.printingNumber, variant_name: row.variantName })}{row.printingOfEditionId ? " · printing of another record" : ""} · {row.isbn13 ?? "ISBN pending"}</small>
    </div>
  );
}

function CoverageTable({ rows, emptyMessage }: { rows: CoverageRow[]; emptyMessage: string }) {
  if (!rows.length) return <p className="status-message">{emptyMessage}</p>;
  return (
    <div className="readiness-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Edition</th>
            <th>Verified sales</th>
            <th>Cover</th>
            <th>Profile</th>
            <th>Next action</th>
            <th>Direct links</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const action = primaryAction(row);
            return (
              <tr key={row.editionId}>
                <td><RowIdentity row={row} /></td>
                <td>{row.verifiedSaleCount} verified{row.comparableSaleCount !== row.verifiedSaleCount ? ` (${row.comparableSaleCount} comparable)` : ""}{row.reviewSaleCount ? ` · ${row.reviewSaleCount} in review` : ""}</td>
                <td><span className={`coverage-badge ${coverToneClass(row.coverStatus)}`}>{coverLabels[row.coverStatus]}</span></td>
                <td>{row.profileId ? <span className="coverage-badge coverage-good">Active</span> : <span className="coverage-badge coverage-neutral">None</span>}</td>
                <td><Link className={`coverage-badge ${action.tone}`} href={action.href}>{action.label}</Link></td>
                <td><RowActions row={row} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CoverageDashboardClient({ rows }: { rows: CoverageRow[] }) {
  const [series, setSeries] = useState("all");
  const [language, setLanguage] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [coverStatus, setCoverStatus] = useState("all");
  const [saleRange, setSaleRange] = useState<SaleRange>("all");
  const [profileFilter, setProfileFilter] = useState<ProfileFilter>("all");

  const seriesOptions = useMemo(() => [...new Set(rows.map((row) => row.series).filter((value): value is string => Boolean(value)))].sort(), [rows]);
  const languageOptions = useMemo(() => [...new Set(rows.map((row) => row.language).filter((value): value is string => Boolean(value)))].sort(), [rows]);
  const publisherOptions = useMemo(() => [...new Set(rows.map((row) => publisherDisplayName(row.publisher)))].sort(), [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (series !== "all" && row.series !== series) return false;
    if (language !== "all" && row.language !== language) return false;
    if (publisher !== "all" && publisherDisplayName(row.publisher) !== publisher) return false;
    if (coverStatus !== "all" && row.coverStatus !== coverStatus) return false;
    if (saleRange === "zero" && row.verifiedSaleCount !== 0) return false;
    if (saleRange === "one_two" && (row.verifiedSaleCount < 1 || row.verifiedSaleCount > 2)) return false;
    if (saleRange === "three_plus" && row.verifiedSaleCount < 3) return false;
    if (profileFilter === "has" && !row.profileId) return false;
    if (profileFilter === "missing" && row.profileId) return false;
    return true;
  }), [rows, series, language, publisher, coverStatus, saleRange, profileFilter]);

  // High-level counts are deliberately unfiltered — a stable overview of the
  // whole catalogue, independent of whatever the priority lists below are
  // currently narrowed to.
  const counts = useMemo(() => ({
    total: rows.length,
    withVerifiedSale: rows.filter((row) => row.verifiedSaleCount > 0).length,
    chartReady: rows.filter((row) => row.comparableSaleCount >= 3).length,
    withVerifiedCover: rows.filter((row) => row.coverStatus === "verified").length,
    missingBoth: rows.filter((row) => row.verifiedSaleCount === 0 && row.coverStatus !== "verified").length,
    withPendingLeads: rows.filter((row) => row.pendingLeadCount > 0).length,
  }), [rows]);

  const targetSprintRows = useMemo(() => rows
    .filter(isTargetSprintRow)
    .sort((a, b) => a.verifiedSaleCount - b.verifiedSaleCount || a.comparableSaleCount - b.comparableSaleCount || (a.series ?? "").localeCompare(b.series ?? "") || (a.language ?? "").localeCompare(b.language ?? "")),
    [rows]);

  const missingSales = useMemo(() => filteredRows
    .filter((row) => row.verifiedSaleCount === 0)
    .sort((a, b) => Number(Boolean(b.profileId)) - Number(Boolean(a.profileId)) || Number(Boolean(b.series)) - Number(Boolean(a.series)) || (a.title ?? "").localeCompare(b.title ?? "")),
    [filteredRows]);

  const weakSales = useMemo(() => filteredRows
    .filter((row) => row.comparableSaleCount === 1 || row.comparableSaleCount === 2)
    .sort((a, b) => b.comparableSaleCount - a.comparableSaleCount || (a.title ?? "").localeCompare(b.title ?? "")),
    [filteredRows]);

  const missingCovers = useMemo(() => filteredRows
    .filter((row) => row.coverStatus !== "verified")
    .sort((a, b) => b.verifiedSaleCount - a.verifiedSaleCount || (a.title ?? "").localeCompare(b.title ?? "")),
    [filteredRows]);

  const highestValue = useMemo(() => filteredRows
    .filter((row) => (row.verifiedSaleCount > 0 && row.coverStatus !== "verified") || (row.coverStatus === "verified" && row.verifiedSaleCount === 0))
    .sort((a, b) => b.verifiedSaleCount - a.verifiedSaleCount),
    [filteredRows]);

  const reviewQueue = useMemo(() => filteredRows
    .filter((row) => row.pendingLeadCount > 0 || row.reviewSaleCount > 0)
    .sort((a, b) => (b.pendingLeadCount + b.reviewSaleCount) - (a.pendingLeadCount + a.reviewSaleCount)),
    [filteredRows]);

  return (
    <>
      <div className="readiness-summary coverage-counts">
        <div><span>{counts.total}</span><strong>Verified catalogue editions</strong><p>Is_verified, with ISBN, publisher and release date on file.</p></div>
        <div><span>{counts.withVerifiedSale}</span><strong>With a verified sale</strong><p>At least one completed sale RAR has proven matches this exact edition.</p></div>
        <div><span>{counts.chartReady}</span><strong>Chart-ready (3+ comparable)</strong><p>3+ verified sales in the same raw/graded group.</p></div>
        <div><span>{counts.withVerifiedCover}</span><strong>With a verified cover</strong><p>Cover art confirmed against a publisher or licensed catalogue record.</p></div>
        <div><span>{counts.missingBoth}</span><strong>Missing sales AND cover</strong><p>Weakest public pages — no market evidence, no confirmed cover.</p></div>
        <div><span>{counts.withPendingLeads}</span><strong>Live Scout leads waiting</strong><p>New listing leads not yet reviewed by staff.</p></div>
      </div>

      <section className="review-list-section coverage-target-sprint">
        <div className="section-intro"><p className="eyebrow">Pricing coverage sprint</p><h2>Target editions</h2><p className="section-copy">One Piece, Hunter × Hunter, Jujutsu Kaisen, Kagurabachi, Naruto, Bleach, Demon Slayer, Attack on Titan, and Initial D — Vol. 1, Japanese and English. Weakest evidence first. This list ignores the filters below; it always shows every target edition.</p></div>
        <CoverageTable rows={targetSprintRows} emptyMessage="No target-sprint editions found." />
      </section>

      <section className="review-list-section coverage-filters-section">
        <div className="section-intro"><p className="eyebrow">Narrow the queues</p><h2>Filters</h2></div>
        <div className="browse-controls coverage-filters" aria-label="Filter coverage priorities">
          <label>Series<select value={series} onChange={(event) => setSeries(event.target.value)}><option value="all">All series</option>{seriesOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{languageOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Publisher<select value={publisher} onChange={(event) => setPublisher(event.target.value)}><option value="all">All publishers</option>{publisherOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Verified sales<select value={saleRange} onChange={(event) => setSaleRange(event.target.value as SaleRange)}><option value="all">Any</option><option value="zero">Zero</option><option value="one_two">One or two</option><option value="three_plus">Three or more</option></select></label>
          <label>Cover status<select value={coverStatus} onChange={(event) => setCoverStatus(event.target.value)}><option value="all">Any</option><option value="missing">Missing</option><option value="candidate">Under review</option><option value="rejected">Not confirmed</option><option value="verified">Verified</option></select></label>
          <label>Collection profile<select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value as ProfileFilter)}><option value="all">Any</option><option value="has">Has active profile</option><option value="missing">No active profile</option></select></label>
        </div>
        <p className="coverage-filter-count"><strong>{filteredRows.length}</strong> of {rows.length} editions match these filters — the queues below only show matches.</p>
      </section>

      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Priority 1</p><h2>Missing sales evidence</h2><p className="section-copy">Zero verified sales. Records already in a recognised series or with a collection profile are surfaced first — they are the fastest to act on.</p></div>
        <CoverageTable rows={missingSales} emptyMessage="No matching editions are missing sales evidence." />
      </section>

      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Priority 2</p><h2>Weak sales evidence</h2><p className="section-copy">One or two verified comparable sales — closest to chart readiness first.</p></div>
        <CoverageTable rows={weakSales} emptyMessage="No matching editions have weak sales evidence." />
      </section>

      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Priority 3</p><h2>Missing verified covers</h2><p className="section-copy">Cover status is missing, under review, or not confirmed. Editions with the strongest sales evidence are surfaced first, since a cover unlocks the most value there.</p></div>
        <CoverageTable rows={missingCovers} emptyMessage="No matching editions are missing a verified cover." />
      </section>

      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Priority 4</p><h2>Highest-value public improvements</h2><p className="section-copy">One gap away from a strong public page: verified sales but no cover, or a verified cover but no sales yet.</p></div>
        <CoverageTable rows={highestValue} emptyMessage="No matching editions are one gap away from a strong page." />
      </section>

      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Priority 5</p><h2>Review queue</h2><p className="section-copy">New Scout leads or pending sale evidence waiting on a staff decision. Nothing here counts as evidence until reviewed.</p></div>
        <CoverageTable rows={reviewQueue} emptyMessage="No matching editions have anything waiting for review." />
      </section>
    </>
  );
}
