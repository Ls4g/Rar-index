"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { formatListingEnd, listingType } from "@/lib/liveListings";

export type ScoutLead = {
  id: string;
  leadIds: string[];
  profileId: string;
  editionId: string;
  editionTitle: string | null;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  isbn13: string | null;
  publisher: string | null;
  sourceListingUrl: string;
  listingTitle: string;
  listingPrice: number | null;
  currency: string | null;
  itemEndAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  rawPayload: unknown;
  score: number;
  confidence: "strong" | "partial" | "insufficient" | "conflict";
  reasons: string[];
  conflicts: string[];
  reviewStatus: "new" | "watching" | "dismissed";
  reviewNotes: string | null;
  reviewedBy: string | null;
  isPriority: boolean;
  isExpired: boolean;
  duplicateCount: number;
  duplicateProfiles: Array<{ profileId: string; editionId: string; editionLabel: string }>;
};

type StatusFilter = "all" | "new" | "watching" | "dismissed";
type ScoreBand = "all" | "75plus" | "50plus" | "below50" | "50to74" | "25to49" | "below25";
type ConfidenceFilter = "all" | "strong" | "partial" | "insufficient" | "conflict";
type ListingTypeFilter = "all" | "Auction" | "Buy it now";
type SortMode = "scoreThenEnd" | "endThenScore";

type Filters = {
  status: StatusFilter;
  includeExpired: boolean;
  scoreBand: ScoreBand;
  confidence: ConfidenceFilter;
  series: string;
  language: string;
  profileId: string;
  publisher: string;
  currency: string;
  priceMin: string;
  priceMax: string;
  listingType: ListingTypeFilter;
  endsSoonOnly: boolean;
  priorityOnly: boolean;
  sortBy: SortMode;
};

const DEFAULT_FILTERS: Filters = {
  status: "new",
  includeExpired: false,
  scoreBand: "50plus",
  confidence: "all",
  series: "all",
  language: "all",
  profileId: "all",
  publisher: "all",
  currency: "all",
  priceMin: "",
  priceMax: "",
  listingType: "all",
  endsSoonOnly: false,
  priorityOnly: false,
  sortBy: "scoreThenEnd",
};

const PAGE_SIZE = 50;
const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
const REVIEWER_STORAGE_KEY = "rar-scout-reviewer";

function loadStoredReviewer() {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(REVIEWER_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function matchesScoreBand(score: number, band: ScoreBand) {
  if (band === "75plus") return score >= 75;
  if (band === "50plus") return score >= 50;
  if (band === "below50") return score < 50;
  if (band === "50to74") return score >= 50 && score < 75;
  if (band === "25to49") return score >= 25 && score < 50;
  if (band === "below25") return score < 25;
  return true;
}

function isEndingSoon(itemEndAt: string | null, now: number) {
  if (!itemEndAt) return false;
  const end = new Date(itemEndAt).getTime();
  return end > now && end - now <= FORTY_EIGHT_HOURS_MS;
}

const confidenceLabels: Record<ScoutLead["confidence"], string> = { strong: "Strong", partial: "Partial", insufficient: "Insufficient", conflict: "Conflict" };
function confidenceTone(confidence: ScoutLead["confidence"]) {
  if (confidence === "strong") return "coverage-good";
  if (confidence === "partial") return "coverage-warning";
  if (confidence === "conflict") return "coverage-urgent";
  return "coverage-neutral";
}
const statusLabels: Record<ScoutLead["reviewStatus"], string> = { new: "New", watching: "Watching", dismissed: "Dismissed" };
function statusTone(status: ScoutLead["reviewStatus"]) {
  if (status === "watching") return "coverage-live";
  if (status === "dismissed") return "coverage-urgent";
  return "coverage-neutral";
}

function formatPrice(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Price not listed";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}
function formatSeenDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value));
}

type QuickView = "reviewNow" | "highConfidence" | "endsSoon" | "watching" | "lowConfidenceBacklog" | "dismissed";
const QUICK_VIEW_ORDER: Array<{ key: QuickView; label: string }> = [
  { key: "reviewNow", label: "Review now" },
  { key: "highConfidence", label: "High-confidence" },
  { key: "endsSoon", label: "Ends soon" },
  { key: "watching", label: "Watching" },
  { key: "lowConfidenceBacklog", label: "Low-confidence backlog" },
  { key: "dismissed", label: "Dismissed / archive" },
];

export default function ScoutTriageInbox({ leads: initialLeads }: { leads: ScoutLead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  // Lazy-initialised (not an effect) so it reads localStorage exactly once,
  // on mount, without the extra render pass a setState-in-effect causes.
  // The value can legitimately differ from the server-rendered "", so the
  // input below opts out of the hydration-mismatch warning for it.
  const [reviewer, setReviewer] = useState(loadStoredReviewer);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [activeQuickView, setActiveQuickView] = useState<QuickView | null>("reviewNow");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rowNotes, setRowNotes] = useState<Record<string, string>>({});
  const [noteOpenFor, setNoteOpenFor] = useState<Set<string>>(new Set());
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [message, setMessage] = useState("");
  // A stable snapshot taken once on mount — used only for filtering
  // (expired/ends-soon checks), so it doesn't need to tick every render,
  // and computing it directly in the render body would call an impure
  // function outside the one place React allows that (useMemo/useState).
  const [now] = useState(() => Date.now());

  function updateFilters(partial: Partial<Filters>, quickView: QuickView | null) {
    setFilters((current) => ({ ...current, ...partial }));
    setActiveQuickView(quickView);
    setVisibleCount(PAGE_SIZE);
    setSelected(new Set());
  }

  const seriesOptions = useMemo(() => [...new Set(leads.map((lead) => lead.series).filter((value): value is string => Boolean(value)))].sort(), [leads]);
  const languageOptions = useMemo(() => [...new Set(leads.map((lead) => lead.language).filter((value): value is string => Boolean(value)))].sort(), [leads]);
  const publisherOptions = useMemo(() => [...new Set(leads.map((lead) => lead.publisher).filter((value): value is string => Boolean(value)))].sort(), [leads]);
  const currencyOptions = useMemo(() => [...new Set(leads.map((lead) => lead.currency).filter((value): value is string => Boolean(value)))].sort(), [leads]);
  const profileOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const lead of leads) {
      if (!seen.has(lead.profileId)) seen.set(lead.profileId, [lead.series || lead.editionTitle, lead.volumeNumber ? `Vol. ${lead.volumeNumber}` : null, lead.language].filter(Boolean).join(" · "));
    }
    return [...seen.entries()];
  }, [leads]);

  const filteredLeads = useMemo(() => leads.filter((lead) => {
    if (filters.status !== "all" && lead.reviewStatus !== filters.status) return false;
    if (!filters.includeExpired && lead.isExpired) return false;
    if (!matchesScoreBand(lead.score, filters.scoreBand)) return false;
    if (filters.confidence !== "all" && lead.confidence !== filters.confidence) return false;
    if (filters.series !== "all" && lead.series !== filters.series) return false;
    if (filters.language !== "all" && lead.language !== filters.language) return false;
    if (filters.profileId !== "all" && lead.profileId !== filters.profileId) return false;
    if (filters.publisher !== "all" && lead.publisher !== filters.publisher) return false;
    if (filters.currency !== "all" && lead.currency !== filters.currency) return false;
    if (filters.priceMin && (lead.listingPrice === null || lead.listingPrice < Number(filters.priceMin))) return false;
    if (filters.priceMax && (lead.listingPrice === null || lead.listingPrice > Number(filters.priceMax))) return false;
    if (filters.listingType !== "all" && listingType(lead.rawPayload) !== filters.listingType) return false;
    if (filters.endsSoonOnly && !isEndingSoon(lead.itemEndAt, now)) return false;
    if (filters.priorityOnly && !lead.isPriority) return false;
    return true;
  }), [leads, filters, now]);

  const sortedLeads = useMemo(() => {
    const copy = [...filteredLeads];
    const endOf = (lead: ScoutLead) => (lead.itemEndAt ? new Date(lead.itemEndAt).getTime() : Infinity);
    copy.sort((a, b) => {
      if (filters.sortBy === "endThenScore") {
        const diff = endOf(a) - endOf(b);
        return diff !== 0 ? diff : b.score - a.score;
      }
      return b.score !== a.score ? b.score - a.score : endOf(a) - endOf(b);
    });
    return copy;
  }, [filteredLeads, filters.sortBy]);

  const visibleLeads = sortedLeads.slice(0, visibleCount);

  // Deliberately computed from the full, unfiltered lead list — stable
  // totals a reviewer can trust regardless of whatever the filters below
  // are currently narrowed to.
  const quickViewCounts: Record<QuickView, number> = useMemo(() => ({
    reviewNow: leads.filter((lead) => lead.reviewStatus === "new" && !lead.isExpired && lead.score >= 50).length,
    highConfidence: leads.filter((lead) => lead.reviewStatus === "new" && !lead.isExpired && lead.score >= 75).length,
    endsSoon: leads.filter((lead) => lead.reviewStatus === "new" && !lead.isExpired && isEndingSoon(lead.itemEndAt, now)).length,
    watching: leads.filter((lead) => lead.reviewStatus === "watching").length,
    lowConfidenceBacklog: leads.filter((lead) => lead.reviewStatus === "new" && !lead.isExpired && lead.score < 50).length,
    dismissed: leads.filter((lead) => lead.reviewStatus === "dismissed").length,
  }), [leads, now]);

  function applyQuickView(view: QuickView) {
    if (view === "reviewNow") updateFilters(DEFAULT_FILTERS, view);
    else if (view === "highConfidence") updateFilters({ ...DEFAULT_FILTERS, scoreBand: "75plus" }, view);
    else if (view === "endsSoon") updateFilters({ ...DEFAULT_FILTERS, scoreBand: "all", endsSoonOnly: true, sortBy: "endThenScore" }, view);
    else if (view === "watching") updateFilters({ ...DEFAULT_FILTERS, status: "watching", scoreBand: "all", includeExpired: true }, view);
    else if (view === "lowConfidenceBacklog") updateFilters({ ...DEFAULT_FILTERS, scoreBand: "below50" }, view);
    else if (view === "dismissed") updateFilters({ ...DEFAULT_FILTERS, status: "dismissed", scoreBand: "all", includeExpired: true }, view);
  }

  function onManualFilterChange(partial: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...partial }));
    // A manual tweak can leave the filters not matching any quick view's
    // preset, so no quick view stays highlighted as if it were still active.
    setActiveQuickView(null);
    setVisibleCount(PAGE_SIZE);
    setSelected(new Set());
  }

  async function submitDecision(rows: ScoutLead[], decision: "watching" | "dismissed", notes: string) {
    if (!reviewer.trim()) { setMessage("Enter a reviewer name above before saving a decision."); return; }
    if (!rows.length) return;
    const rowIds = rows.map((row) => row.id);
    const leadIds = rows.flatMap((row) => row.leadIds);
    setSavingIds((current) => new Set([...current, ...rowIds]));
    setMessage("");
    try {
      const response = await fetch("/api/scout-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds, decision, reviewer, notes }),
      });
      const result = await response.json() as { error?: string; failed?: number; failedLeadIds?: string[] };
      if (!response.ok) { setMessage(result.error ?? "The Scout lead decision could not be saved."); return; }
      const failedLeadIds = new Set(result.failedLeadIds ?? []);
      // A grouped eBay listing can already have a human decision on one
      // secondary profile. The API protects that decision, while still
      // allowing the currently displayed (primary) new lead to be saved.
      const savedRows = rows.filter((row) => !failedLeadIds.has(row.id));
      const failedRows = rows.filter((row) => !savedRows.includes(row));
      const rowIdSet = new Set(savedRows.map((row) => row.id));
      setLeads((current) => current.map((lead) => rowIdSet.has(lead.id) ? { ...lead, reviewStatus: decision, reviewNotes: notes || lead.reviewNotes, reviewedBy: reviewer } : lead));
      setSelected((current) => { const next = new Set(current); for (const id of rowIdSet) next.delete(id); return next; });
      setRowNotes((current) => { const next = { ...current }; for (const id of rowIdSet) delete next[id]; return next; });
      if (!failedRows.length) setBulkNote("");
      setMessage(
        failedRows.length
          ? `${decision === "watching" ? "Watching" : "Dismissed"} ${savedRows.length} listing${savedRows.length === 1 ? "" : "s"}. ${failedRows.length} could not be saved and remain selected — try again or review them individually.`
          : `${decision === "watching" ? "Watching" : "Dismissed"} ${savedRows.length} listing${savedRows.length === 1 ? "" : "s"}.`,
      );
    } catch {
      setMessage("The Scout lead decision could not be saved. Check the connection and try again.");
    } finally {
      setSavingIds((current) => { const next = new Set(current); for (const id of rowIds) next.delete(id); return next; });
    }
  }

  function updateReviewer(value: string) {
    setReviewer(value);
    try {
      window.localStorage.setItem(REVIEWER_STORAGE_KEY, value);
    } catch {
      // Storage can be unavailable (private browsing, disabled storage); the
      // name still works for this session, it just won't persist.
    }
  }

  function toggleSelected(id: string) {
    setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function toggleSelectAllVisible() {
    setSelected((current) => {
      const visibleIds = visibleLeads.map((lead) => lead.id);
      const allSelected = visibleIds.every((id) => current.has(id));
      if (allSelected) { const next = new Set(current); for (const id of visibleIds) next.delete(id); return next; }
      return new Set([...current, ...visibleIds]);
    });
  }

  const selectedRows = leads.filter((lead) => selected.has(lead.id));

  return (
    <div className="scout-inbox">
      <div className="scout-reviewer-bar">
        <label>Reviewer<input onChange={(event) => updateReviewer(event.target.value)} placeholder="Your name or initials" suppressHydrationWarning value={reviewer} /></label>
        <small>Remembered on this device — every Watch, Dismiss, and bulk decision below uses this name.</small>
      </div>

      <div className="scout-quick-views" role="group" aria-label="Quick views">
        {QUICK_VIEW_ORDER.map((view) => (
          <button className={`scout-quick-view${activeQuickView === view.key ? " is-active" : ""}`} key={view.key} onClick={() => applyQuickView(view.key)} type="button">
            {view.label}<span>{quickViewCounts[view.key]}</span>
          </button>
        ))}
      </div>

      <details className="browse-controls scout-filters-panel" open>
        <summary>Filters</summary>
        <div className="scout-filters-grid">
          <label>Review status<select onChange={(event) => onManualFilterChange({ status: event.target.value as StatusFilter })} value={filters.status}>
            <option value="all">Any</option><option value="new">New</option><option value="watching">Watching</option><option value="dismissed">Dismissed</option>
          </select></label>
          <label>Match score<select onChange={(event) => onManualFilterChange({ scoreBand: event.target.value as ScoreBand })} value={filters.scoreBand}>
            <option value="all">Any score</option><option value="75plus">75+ (strong)</option><option value="50plus">50+ (review now)</option><option value="50to74">50–74 only</option><option value="25to49">25–49 only</option><option value="below25">Below 25</option>
          </select></label>
          <label>Confidence<select onChange={(event) => onManualFilterChange({ confidence: event.target.value as ConfidenceFilter })} value={filters.confidence}>
            <option value="all">Any</option><option value="strong">Strong</option><option value="partial">Partial</option><option value="insufficient">Insufficient</option><option value="conflict">Conflict</option>
          </select></label>
          <label>Listing type<select onChange={(event) => onManualFilterChange({ listingType: event.target.value as ListingTypeFilter })} value={filters.listingType}>
            <option value="all">Any</option><option value="Auction">Auction</option><option value="Buy it now">Buy it now</option>
          </select></label>
          <label>Series<select onChange={(event) => onManualFilterChange({ series: event.target.value })} value={filters.series}>
            <option value="all">All series</option>{seriesOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Language<select onChange={(event) => onManualFilterChange({ language: event.target.value })} value={filters.language}>
            <option value="all">All languages</option>{languageOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Publisher<select onChange={(event) => onManualFilterChange({ publisher: event.target.value })} value={filters.publisher}>
            <option value="all">All publishers</option>{publisherOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Collection profile<select onChange={(event) => onManualFilterChange({ profileId: event.target.value })} value={filters.profileId}>
            <option value="all">All profiles</option>{profileOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <label>Currency<select onChange={(event) => onManualFilterChange({ currency: event.target.value })} value={filters.currency}>
            <option value="all">Any</option>{currencyOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>Price range<span className="scout-filters-price">
            <input inputMode="decimal" onChange={(event) => onManualFilterChange({ priceMin: event.target.value })} placeholder="Min" type="number" value={filters.priceMin} />
            <input inputMode="decimal" onChange={(event) => onManualFilterChange({ priceMax: event.target.value })} placeholder="Max" type="number" value={filters.priceMax} />
          </span></label>
        </div>
        <div className="scout-filters-checkboxes">
          <label><input checked={filters.includeExpired} onChange={(event) => onManualFilterChange({ includeExpired: event.target.checked })} type="checkbox" /> Include expired listings</label>
          <label><input checked={filters.endsSoonOnly} onChange={(event) => onManualFilterChange({ endsSoonOnly: event.target.checked })} type="checkbox" /> Ends within 48 hours</label>
          <label><input checked={filters.priorityOnly} onChange={(event) => onManualFilterChange({ priorityOnly: event.target.checked })} type="checkbox" /> Priority series only</label>
          <label><input checked={filters.sortBy === "endThenScore"} onChange={(event) => onManualFilterChange({ sortBy: event.target.checked ? "endThenScore" : "scoreThenEnd" })} type="checkbox" /> Sort by ending soonest first</label>
        </div>
      </details>

      <p className="coverage-filter-count"><strong>{filteredLeads.length}</strong> of {leads.length} unique listings match these filters · showing {visibleLeads.length}.</p>

      {visibleLeads.length ? (
        <>
          <label className="scout-select-all">
            <input checked={visibleLeads.length > 0 && visibleLeads.every((lead) => selected.has(lead.id))} onChange={toggleSelectAllVisible} type="checkbox" /> Select all {visibleLeads.length} visible
          </label>
          <div className="scout-lead-list">
            {visibleLeads.map((lead) => {
              const saving = savingIds.has(lead.id);
              const noteOpen = noteOpenFor.has(lead.id);
              return (
                <div className={`scout-lead-row${selected.has(lead.id) ? " is-selected" : ""}${saving ? " is-saving" : ""}`} key={lead.id}>
                  <div className="scout-lead-select">
                    <input aria-label={`Select ${lead.listingTitle}`} checked={selected.has(lead.id)} onChange={() => toggleSelected(lead.id)} type="checkbox" />
                  </div>
                  <div className="scout-lead-main">
                    <div className="scout-lead-topline">
                      <a className="scout-lead-title" href={lead.sourceListingUrl} rel="noreferrer" target="_blank">{lead.listingTitle}</a>
                    </div>
                    <p className="scout-lead-meta">
                      <strong>{formatPrice(lead.listingPrice, lead.currency)}</strong> · {listingType(lead.rawPayload)} · ends {formatListingEnd(lead.itemEndAt)}{lead.isExpired ? " (expired)" : ""} · first seen {formatSeenDate(lead.firstSeenAt)}, last seen {formatSeenDate(lead.lastSeenAt)}
                    </p>
                    <p className="scout-lead-meta">
                      <Link className="scout-lead-edition-link" href={`/edition/${lead.editionId}`} target="_blank">{lead.editionTitle ?? "Edition"}</Link>
                      {" · "}{[lead.series, lead.volumeNumber ? `Vol. ${lead.volumeNumber}` : null, lead.language, lead.publisher].filter(Boolean).join(" · ")}
                      {" · "}<Link className="scout-lead-edition-link" href={`/collection-profiles/${lead.profileId}`} target="_blank">profile ↗</Link>
                      {lead.isPriority ? " · priority series" : ""}
                    </p>
                    <div className="scout-lead-signals">
                      {lead.reasons.length ? <span className="scout-reasons">{lead.reasons.join(" · ")}</span> : null}
                      {lead.conflicts.length ? <span className="scout-conflicts">{lead.conflicts.join(" · ")}</span> : null}
                    </div>
                    {lead.duplicateCount > 0 ? (
                      <p className="scout-lead-duplicate">Also matches {lead.duplicateCount} other profile{lead.duplicateCount === 1 ? "" : "s"}: {lead.duplicateProfiles.map((other) => other.editionLabel).join("; ")}. Acting here decides all of them.</p>
                    ) : null}
                  </div>
                  <div className="scout-lead-badges">
                    <span className={`coverage-badge ${confidenceTone(lead.confidence)}`}>{confidenceLabels[lead.confidence]} · {lead.score}/100</span>
                    <span className={`coverage-badge ${statusTone(lead.reviewStatus)}`}>{statusLabels[lead.reviewStatus]}</span>
                    {lead.reviewStatus !== "new" ? (
                      <p className="scout-lead-decided"><strong>{lead.reviewedBy ?? "Unknown reviewer"}</strong>{lead.reviewNotes || "No note recorded."}</p>
                    ) : null}
                    {lead.reviewStatus === "new" ? (
                      <div className="scout-lead-actions">
                        <div className="scout-lead-action-row">
                          <button className="is-watch" disabled={saving} onClick={() => submitDecision([lead], "watching", rowNotes[lead.id] ?? "")} type="button">Watch</button>
                          <button className="is-dismiss" disabled={saving} onClick={() => submitDecision([lead], "dismissed", rowNotes[lead.id] ?? "")} type="button">Dismiss</button>
                        </div>
                        <button className="scout-lead-note-toggle" onClick={() => setNoteOpenFor((current) => { const next = new Set(current); if (next.has(lead.id)) next.delete(lead.id); else next.add(lead.id); return next; })} type="button">{noteOpen ? "Hide note" : "+ note"}</button>
                        {noteOpen ? <textarea className="scout-lead-note" onChange={(event) => setRowNotes((current) => ({ ...current, [lead.id]: event.target.value }))} placeholder="Optional evidence note" value={rowNotes[lead.id] ?? ""} /> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          {visibleCount < sortedLeads.length ? (
            <div className="scout-load-more"><button onClick={() => setVisibleCount((current) => current + PAGE_SIZE)} type="button">Load {Math.min(PAGE_SIZE, sortedLeads.length - visibleCount)} more</button></div>
          ) : null}
        </>
      ) : (
        <div className="review-empty"><strong>No leads match these filters.</strong><p>Try a different quick view, or widen the filters above.</p></div>
      )}

      {message ? <p className="review-submit-row" role="status">{message}</p> : null}

      {selected.size > 0 ? (
        <div className="scout-bulk-bar">
          <strong>{selected.size} selected</strong>
          <input onChange={(event) => setBulkNote(event.target.value)} placeholder="Optional note for all selected" value={bulkNote} />
          <button className="is-watch" disabled={savingIds.size > 0} onClick={() => submitDecision(selectedRows, "watching", bulkNote)} type="button">Watch selected</button>
          <button className="is-dismiss" disabled={savingIds.size > 0} onClick={() => submitDecision(selectedRows, "dismissed", bulkNote)} type="button">Dismiss selected</button>
          <button className="is-clear" onClick={() => setSelected(new Set())} type="button">Clear selection</button>
        </div>
      ) : null}
    </div>
  );
}
