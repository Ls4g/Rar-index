"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { decisionsFor, sharedDecisionsFor } from "@/lib/listingOutcomeDecisions";
import {
  classifyListingOutcome,
  dismissalDecision,
  dismissalNotes,
  outcomeMatchesQueue,
  type DismissalReason,
  type OutcomeQueue,
} from "@/lib/listingOutcomeTriage";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

export type OutcomeRow = {
  id: string;
  externalId: string;
  status: string;
  editionLabel: string;
  editionId: string;
  profileId: string | null;
  listingTitle: string;
  imageUrl: string | null;
  sourceListingUrl: string;
  askingPrice: number | null;
  currency: string | null;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  buyingFormat: string | null;
  bidCount: number | null;
  scheduledEndAt: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  outcomeReason: string | null;
  outcomeProvider: string | null;
  matchScore: number | null;
  matchConfidence: string | null;
  matchReasons: string[];
  matchConflicts: string[];
  checkAttempts: number;
  nextCheckAt: string | null;
  lastError: string | null;
  reviewedBy: string | null;
  observationId: string | null;
  checks: Array<{ provider: string; attempt: number; httpStatus: number | null; state: string | null; detail: string | null; checkedAt: string }>;
};

export type OutcomeCapability = { provider: string; available: boolean; canConfirmSales: boolean; detail: string };

type OutcomeView = "attention" | "watching" | "finished";
type SortMode = "priority" | "match" | "newest";

const QUEUES: Array<{ key: OutcomeQueue; label: string }> = [
  { key: "worth_checking", label: "Worth checking" },
  { key: "best_offer", label: "Best Offer" },
  { key: "high_value", label: "High value" },
  { key: "conflict", label: "Edition conflicts" },
  { key: "graded", label: "Graded" },
  { key: "lot", label: "Lots / sets" },
  { key: "parked", label: "Parked" },
  { key: "all", label: "All unresolved" },
];

const DISMISSAL_REASONS: Array<{ key: DismissalReason; label: string }> = [
  { key: "", label: "No reason selected" },
  { key: "unsold", label: "It did not sell" },
  { key: "wrong_edition", label: "Wrong edition" },
  { key: "not_enough_evidence", label: "Not enough evidence" },
  { key: "graded", label: "Graded listing" },
  { key: "lot", label: "Lot or multi-volume listing" },
];

function viewFor(row: OutcomeRow): OutcomeView {
  if (row.reviewedBy || ["unsold", "review_complete"].includes(row.status)) return "finished";
  if (row.status === "active") return "watching";
  return "attention";
}

function plainStatus(row: OutcomeRow) {
  switch (row.status) {
    case "sold_candidate": return { label: "Possible sale", help: "Completed-sale details are present. Confirm that the source is this exact RAR edition." };
    case "ended_pending_check": return { label: "Listing ended", help: "The listing ended, but RAR cannot yet prove that it sold." };
    case "ambiguous": return { label: "Outcome unclear", help: "RAR found incomplete or conflicting evidence." };
    case "inaccessible": return { label: "Could not be checked", help: "eBay no longer provides enough information to determine the outcome." };
    case "active": return { label: "Still live", help: "This listing remains under observation and creates no sale evidence." };
    case "unsold": return { label: "Did not sell", help: "This listing has been classified as unsold." };
    case "review_complete": return { label: "Review complete", help: "A staff decision has already been recorded." };
    default: return { label: row.status.replaceAll("_", " "), help: "Review the listing information below." };
  }
}

function money(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Not reported";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

function when(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function ListingOutcomesPanel({ rows, capabilities, counts, renderedAt }: {
  rows: OutcomeRow[];
  capabilities: OutcomeCapability[];
  counts: Record<string, number | string | null>;
  renderedAt: string;
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useStaffReviewer();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [dismissReasons, setDismissReasons] = useState<Record<string, DismissalReason>>({});
  const [dismissOpen, setDismissOpen] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [testingEbay, setTestingEbay] = useState(false);
  const [view, setView] = useState<OutcomeView>("attention");
  const [queue, setQueue] = useState<OutcomeQueue>("worth_checking");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortMode>("priority");
  const [visibleLimit, setVisibleLimit] = useState(25);
  const [bestOfferInputs, setBestOfferInputs] = useState<Record<string, { price: string; currency: string; soldAt: string; confirmed: boolean }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [bulkDismissReason, setBulkDismissReason] = useState<DismissalReason>("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const canConfirmSales = capabilities.some((capability) => capability.canConfirmSales);
  const triageNow = useMemo(() => new Date(renderedAt), [renderedAt]);
  const attentionRows = useMemo(() => rows.filter((row) => viewFor(row) === "attention"), [rows]);
  const viewCounts = useMemo(() => rows.reduce<Record<OutcomeView, number>>((totals, row) => {
    totals[viewFor(row)] += 1;
    return totals;
  }, { attention: 0, watching: 0, finished: 0 }), [rows]);
  const queueCounts = useMemo(() => Object.fromEntries(QUEUES.map(({ key }) => [
    key,
    attentionRows.filter((row) => outcomeMatchesQueue(row, key, triageNow)).length,
  ])) as Record<OutcomeQueue, number>, [attentionRows, triageNow]);

  const visibleRows = useMemo(() => {
    const normalisedQuery = query.trim().toLocaleLowerCase();
    const filtered = rows.filter((row) => {
      if (viewFor(row) !== view) return false;
      if (view === "attention" && !outcomeMatchesQueue(row, queue, triageNow)) return false;
      return !normalisedQuery || `${row.listingTitle} ${row.editionLabel} ${row.externalId}`.toLocaleLowerCase().includes(normalisedQuery);
    });
    return filtered.sort((a, b) => {
      if (sort === "match") return (b.matchScore ?? -1) - (a.matchScore ?? -1);
      if (sort === "newest") return Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt);
      return classifyListingOutcome(b, triageNow).priority - classifyListingOutcome(a, triageNow).priority;
    });
  }, [query, queue, rows, sort, triageNow, view]);

  const displayedRows = visibleRows.slice(0, visibleLimit);
  const selectable = view !== "finished";
  const selectableRows = selectable ? displayedRows : [];
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const sharedDecisions = sharedDecisionsFor(selectedRows);
  const canBulkWatch = sharedDecisions.some((decision) => decision.key === "keep_watching");
  const canBulkMarkUnsolved = sharedDecisions.some((decision) => decision.key === "mark_unsold");
  const nextCheck = typeof counts.watch_next_check_at === "string" ? counts.watch_next_check_at : null;
  const checkOverdue = nextCheck ? Date.parse(nextCheck) < Date.parse(renderedAt) : false;

  function toggleSet(setter: Dispatch<SetStateAction<Set<string>>>, id: string) {
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelected((current) => {
      const ids = selectableRows.map((row) => row.id);
      const allSelected = ids.length > 0 && ids.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of ids) { if (allSelected) next.delete(id); else next.add(id); }
      return next;
    });
  }

  function resetList() {
    setVisibleLimit(25);
    setSelected(new Set());
  }

  function changeView(next: OutcomeView) {
    setView(next);
    resetList();
  }

  function changeQueue(next: OutcomeQueue) {
    setQueue(next);
    resetList();
  }

  async function decideSelected(decision: string, decisionNotes = bulkNote) {
    if (!reviewer.trim()) { setMessage("Add your name or initials first."); return; }
    if (!selectedRows.length) return;
    setBulkSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "bulk-decide", outcomeIds: selectedRows.map((row) => row.id), decision, reviewer, notes: decisionNotes }),
      });
      const result = await response.json() as { error?: string; saved?: number; savedIds?: string[]; failed?: number; failures?: Array<{ outcomeId: string; error: string }> };
      if (!response.ok) { setMessage(result.error ?? "The decisions could not be saved."); return; }
      const savedIds = new Set(result.savedIds ?? []);
      setSelected((current) => new Set([...current].filter((id) => !savedIds.has(id))));
      if (!result.failed) {
        setBulkNote("");
        setBulkDismissReason("");
        setMessage(`Saved ${result.saved} listing${result.saved === 1 ? "" : "s"}.`);
      } else {
        setMessage(`Saved ${result.saved}. ${result.failed} could not be saved and remain selected — ${result.failures?.[0]?.error ?? "try again or review them individually."}`);
      }
      router.refresh();
    } catch {
      setMessage("The decisions could not be saved. Check the connection and try again.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function runPipeline() {
    setRunning(true);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "run" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The pipeline could not run.");
      const checks = result.checks ?? {};
      setMessage(`Watching ${result.captured?.captured ?? 0} new · ${result.promoted ?? 0} newly ended · ${checks.checked ?? 0} checked · ${checks.soldCandidates ?? 0} sold candidates · ${checks.unsold ?? 0} unsold · ${checks.ambiguous ?? 0} ambiguous · ${checks.inaccessible ?? 0} inaccessible.${checks.errors?.length ? ` First error: ${checks.errors[0]}` : ""}`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The pipeline could not run.");
    } finally {
      setRunning(false);
    }
  }

  async function decide(outcomeId: string, decision: string, decisionNotes?: string) {
    if (!reviewer.trim()) { setMessage("Add your name or initials first."); return; }
    setSaving(`${outcomeId}:${decision}`);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcomeId, decision, reviewer, notes: decisionNotes ?? notes[outcomeId] ?? "" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The decision could not be saved.");
      setMessage(decision === "confirm_sale"
        ? "Sale created and verified in one step. It is now in the catalogue evidence."
        : decision === "keep_watching"
          ? "Listing returned to the watch queue. No sale evidence was created."
          : "Decision saved.");
      setDismissOpen((current) => { const next = new Set(current); next.delete(outcomeId); return next; });
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The decision could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  async function dismiss(row: OutcomeRow) {
    const reason = dismissReasons[row.id] ?? "";
    await decide(row.id, dismissalDecision(reason), dismissalNotes(reason, notes[row.id] ?? ""));
  }

  async function testEbayUserAccess() {
    setTestingEbay(true);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test-ebay-user-access" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The eBay account test failed.");
      setMessage(`eBay account test: ${result.state}. ${result.detail}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The eBay account test failed.");
    } finally {
      setTestingEbay(false);
    }
  }

  async function recordBestOfferPrice(row: OutcomeRow) {
    if (!reviewer.trim()) { setMessage("Add your name or initials first."); return; }
    const input = bestOfferInputs[row.id] ?? { price: "", currency: row.currency ?? "USD", soldAt: "", confirmed: false };
    if (!input.confirmed) { setMessage("Confirm that the 130point result matches this exact eBay item number."); return; }
    setSaving(`${row.id}:best-offer`);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record-best-offer-price", outcomeId: row.id, reviewer, notes: notes[row.id] ?? "", soldPrice: Number(input.price), soldCurrency: input.currency, soldAt: input.soldAt }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The Best Offer price could not be saved.");
      setMessage("Accepted Best Offer price recorded as a sold candidate. Review the exact edition to publish it.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The Best Offer price could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="listing-outcomes">
      <div className="section-intro">
        <p className="eyebrow">Watch to sale</p>
        <h2>Review only what matters</h2>
        <p className="section-copy">RAR prioritises outcomes where your judgement can create trustworthy evidence. Everything uncertain remains available without crowding the main inbox.</p>
      </div>

      <div className="outcome-workspace-summary" aria-label="Listing outcome summary">
        <div className="is-attention"><strong>{queueCounts.worth_checking}</strong><span>Worth checking</span></div>
        <div><strong>{queueCounts.parked}</strong><span>Safely parked</span></div>
        <div><strong>{counts.watch_listings_active ?? 0}</strong><span>Still being watched</span></div>
        <div><strong>{counts.watch_confirmed_sales ?? 0}</strong><span>Sales confirmed</span></div>
      </div>
      {nextCheck ? <p className={`outcome-next-check${checkOverdue ? " is-overdue" : ""}`}>{checkOverdue ? "Outcome check overdue since" : "Next outcome check due"} {when(nextCheck)}.</p> : null}

      <div className={`outcome-reviewer-panel${reviewer.trim() ? " is-ready" : ""}`}>
        <div><strong>Reviewer</strong><p>Enter this once. Every decision remains attributable.</p></div>
        <label htmlFor="outcome-reviewer">Name or initials</label>
        <input id="outcome-reviewer" onChange={(event) => setReviewer(event.target.value)} placeholder="Example: SP" value={reviewer} />
        <span>{reviewer.trim() ? `Ready — recording decisions as ${reviewer.trim()}.` : "Required before saving decisions."}</span>
      </div>
      {message ? <p className="outcome-message" role="status">{message}</p> : null}

      <div className="outcome-view-tabs" role="tablist" aria-label="Listing outcome views">
        {([["attention", "Needs review", viewCounts.attention], ["watching", "Still watching", viewCounts.watching], ["finished", "Finished", viewCounts.finished]] as Array<[OutcomeView, string, number]>).map(([key, label, count]) => (
          <button aria-selected={view === key} className={view === key ? "is-active" : ""} key={key} onClick={() => changeView(key)} role="tab" type="button">{label} <span>{count}</span></button>
        ))}
      </div>

      {view === "attention" ? (
        <div className="outcome-triage-tools">
          <div className="outcome-quick-filters" aria-label="Outcome quick filters">
            {QUEUES.map(({ key, label }) => (
              <button className={queue === key ? "is-active" : ""} key={key} onClick={() => changeQueue(key)} type="button">{label} <span>{queueCounts[key]}</span></button>
            ))}
          </div>
          <div className="outcome-search-sort">
            <label>Find a listing<input onChange={(event) => { setQuery(event.target.value); resetList(); }} placeholder="Title, edition or item number" type="search" value={query} /></label>
            <label>Order<select onChange={(event) => setSort(event.target.value as SortMode)} value={sort}><option value="priority">Best opportunity first</option><option value="match">Strongest match first</option><option value="newest">Newest first</option></select></label>
          </div>
          {queue === "parked" ? <p className="outcome-parked-note">These ended without enough evidence, or were machine-detected as graded, lots or possible edition conflicts. They remain searchable and auditable, but no longer dominate your working inbox.</p> : null}
        </div>
      ) : null}

      <details className={`outcome-system-tools${canConfirmSales ? "" : " is-degraded"}`}>
        <summary>{canConfirmSales ? "System status and manual checks" : "System limitation: automatic sale confirmation is unavailable"}</summary>
        <div className="outcome-system-tools-body">
          <p>{canConfirmSales ? "RAR can retrieve completed-sale evidence from an authorised provider." : "RAR can detect that a listing disappeared, but it cannot prove that it sold. Unproven outcomes are parked unless another useful signal makes them worth checking."}</p>
          <ul>{capabilities.map((capability) => <li key={capability.provider}><b>{capability.provider}:</b> {capability.detail}</li>)}</ul>
          <div className="outcome-actions">
            <button className="outcome-run-button" type="button" disabled={running} onClick={runPipeline}>{running ? "Checking listings…" : "Run outcome checks now"}</button>
            <button type="button" className="secondary-action" disabled={testingEbay} onClick={testEbayUserAccess}>{testingEbay ? "Testing…" : "Test eBay connection"}</button>
          </div>
        </div>
      </details>

      <div className="outcome-list-toolbar">
        <p><strong>{visibleRows.length}</strong> listing{visibleRows.length === 1 ? "" : "s"} in this view</p>
        {visibleRows.length && selectable ? (
          <label className="outcome-select-all"><input checked={selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.id))} onChange={toggleSelectAllVisible} type="checkbox" />Select all {selectableRows.length} shown{selected.size ? <span> · {selected.size} selected</span> : null}</label>
        ) : null}
      </div>

      {visibleRows.length ? (
        <div className="outcome-list">
          {displayedRows.map((row) => {
            const status = plainStatus(row);
            const triage = classifyListingOutcome(row, triageNow);
            const isExpanded = expanded.has(row.id);
            const isDismissing = dismissOpen.has(row.id);
            const rowDecisions = decisionsFor(row);
            const canKeepWatching = rowDecisions.some((decision) => decision.key === "keep_watching");
            const canConfirm = rowDecisions.some((decision) => decision.key === "confirm_sale");
            const isBestOffer = triage.isBestOffer;
            return (
              <article className={`outcome-card status-${row.status}${selected.has(row.id) ? " is-selected" : ""}${isExpanded ? " is-expanded" : ""}`} key={row.id}>
                <div className="outcome-card-head">
                  {selectable ? <input aria-label={`Select ${row.listingTitle}`} checked={selected.has(row.id)} className="outcome-select" onChange={() => toggleSet(setSelected, row.id)} type="checkbox" /> : null}
                  {row.imageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element -- marketplace CDN, not a configured next/image host */
                    <img alt="" className="outcome-thumb" loading="lazy" src={row.imageUrl} />
                  ) : <span className="outcome-thumb is-empty" aria-hidden="true">R</span>}
                  <div className="outcome-card-copy">
                    <div className="outcome-card-labels"><span className={`coverage-pill status-${row.status}`}>{status.label}</span>{triage.isHighValue ? <span className="outcome-signal">High value</span> : null}{isBestOffer ? <span className="outcome-signal">Best Offer</span> : null}</div>
                    <h3>{row.listingTitle}</h3>
                    <p className="outcome-edition">{row.editionLabel}</p>
                    <p className="outcome-why"><strong>{money(row.soldPrice ?? row.askingPrice, row.soldCurrency ?? row.currency)}</strong><span>Match {row.matchScore ?? "—"}</span><span>{triage.reason}</span></p>
                  </div>
                </div>

                {!row.reviewedBy ? (
                  <div className="outcome-primary-actions">
                    {row.status === "active" ? <a className="outcome-review-button" href={row.sourceListingUrl} rel="noreferrer" target="_blank">Open live listing ↗</a> : <button className="outcome-review-button" onClick={() => toggleSet(setExpanded, row.id)} type="button">{isExpanded ? "Close review" : canConfirm ? "Review sale" : "Check possible sale"}</button>}
                    {canKeepWatching ? <button className="outcome-watch-button" disabled={!reviewer.trim() || Boolean(saving)} onClick={() => void decide(row.id, "keep_watching")} type="button">{saving === `${row.id}:keep_watching` ? "Saving…" : "Keep watching"}</button> : null}
                    <button className="outcome-dismiss-button" onClick={() => toggleSet(setDismissOpen, row.id)} type="button">{isDismissing ? "Cancel dismiss" : "Dismiss"}</button>
                    {row.status === "active" ? <button className="outcome-details-button" onClick={() => toggleSet(setExpanded, row.id)} type="button">{isExpanded ? "Hide details" : "View details"}</button> : null}
                  </div>
                ) : null}

                {isDismissing && !row.reviewedBy ? (
                  <div className="outcome-dismiss-panel">
                    <strong>Dismiss this listing</strong>
                    <p>A reason can help future triage, but it is optional.</p>
                    <label>Reason (optional)<select onChange={(event) => setDismissReasons((current) => ({ ...current, [row.id]: event.target.value as DismissalReason }))} value={dismissReasons[row.id] ?? ""}>{DISMISSAL_REASONS.filter((reason) => reason.key !== "unsold" || rowDecisions.some((decision) => decision.key === "mark_unsold")).map((reason) => <option key={reason.key || "none"} value={reason.key}>{reason.label}</option>)}</select></label>
                    <label>Note (optional)<input onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Only if something needs saying" value={notes[row.id] ?? ""} /></label>
                    <button className="outcome-dismiss-confirm" disabled={!reviewer.trim() || Boolean(saving)} onClick={() => void dismiss(row)} type="button">{saving?.startsWith(`${row.id}:`) ? "Saving…" : "Dismiss listing"}</button>
                  </div>
                ) : null}

                {isExpanded ? (
                  <div className="outcome-expanded-review">
                    <div className="outcome-human-prompt"><strong>Why it needs you</strong><p>{status.help}</p></div>
                    <div className="outcome-source-links"><a href={row.sourceListingUrl} rel="noreferrer" target="_blank">Open original eBay listing ↗</a><a href={`/edition/${row.editionId}`}>Open RAR edition</a>{row.profileId ? <a href={`/collection-profiles/${row.profileId}`}>Search profile</a> : null}{row.observationId ? <a href={`/review?observation=${row.observationId}`}>Resulting sale</a> : null}</div>
                    <dl className="outcome-facts"><div><dt>Reported sale</dt><dd>{money(row.soldPrice, row.soldCurrency)}</dd></div><div><dt>Sold / ended</dt><dd>{when(row.soldAt ?? row.scheduledEndAt)}</dd></div><div><dt>Asking price when seen</dt><dd>{money(row.askingPrice, row.currency)}</dd></div><div><dt>Match</dt><dd>{row.matchScore ?? "—"}{row.matchConfidence ? ` · ${row.matchConfidence}` : ""}</dd></div></dl>
                    {row.outcomeReason ? <p className="outcome-evidence"><b>Evidence:</b> {row.outcomeReason}</p> : null}

                    {isBestOffer ? (
                      <div className="best-offer-corroboration">
                        <div><strong>Check the hidden Best Offer price</strong><p>Only do this when you choose to investigate this listing. Search 130point using the exact eBay item number; eBay remains the original source.</p></div>
                        <div className="best-offer-tools"><code>{row.externalId}</code><button className="secondary-action" onClick={() => void navigator.clipboard.writeText(row.externalId).then(() => setMessage(`Copied eBay item ${row.externalId}.`))} type="button">Copy item number</button><a className="secondary-action" href="https://130point.com/sales/" rel="noreferrer" target="_blank">Open 130point ↗</a></div>
                        <div className="best-offer-fields"><label>Accepted price<input inputMode="decimal" min="0.01" onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { currency: row.currency ?? "USD", soldAt: "", confirmed: false }), price: event.target.value } }))} placeholder="0.00" step="0.01" type="number" value={bestOfferInputs[row.id]?.price ?? ""} /></label><label>Currency<select onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { price: "", soldAt: "", confirmed: false }), currency: event.target.value } }))} value={bestOfferInputs[row.id]?.currency ?? row.currency ?? "USD"}><option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="JPY">JPY</option><option value="CAD">CAD</option><option value="AUD">AUD</option></select></label><label>Sale date<input max={new Date().toISOString().slice(0, 10)} onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { price: "", currency: row.currency ?? "USD", confirmed: false }), soldAt: event.target.value } }))} type="date" value={bestOfferInputs[row.id]?.soldAt ?? ""} /></label></div>
                        <label className="best-offer-confirm"><input checked={bestOfferInputs[row.id]?.confirmed ?? false} onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { price: "", currency: row.currency ?? "USD", soldAt: "" }), confirmed: event.target.checked } }))} type="checkbox" /> I matched this exact eBay item number in 130point.</label>
                        <button className="catalogue-bulk-approve" disabled={Boolean(saving)} onClick={() => void recordBestOfferPrice(row)} type="button">{saving === `${row.id}:best-offer` ? "Saving…" : "Save as sold candidate"}</button>
                      </div>
                    ) : null}

                    {canConfirm ? <div className="outcome-confirm-sale"><label>Note (optional)<input onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Only if something needs saying" value={notes[row.id] ?? ""} /></label><button disabled={!reviewer.trim() || Boolean(saving)} onClick={() => void decide(row.id, "confirm_sale")} type="button">{saving === `${row.id}:confirm_sale` ? "Verifying…" : "Verify this sale"}</button></div> : null}

                    <details className="outcome-history"><summary>Technical details and check history ({row.checkAttempts})</summary><dl className="outcome-technical-facts"><div><dt>Listing format</dt><dd>{row.buyingFormat?.replaceAll("_", " ").toLowerCase() ?? "—"}{row.bidCount !== null ? ` · ${row.bidCount} bids` : ""}</dd></div><div><dt>First watched</dt><dd>{when(row.firstSeenAt)}</dd></div><div><dt>Last seen live</dt><dd>{when(row.lastSeenAt)}</dd></div><div><dt>eBay item number</dt><dd>{row.externalId}</dd></div></dl>{row.matchConflicts.length ? <p className="outcome-conflict"><b>Match conflicts:</b> {row.matchConflicts.join("; ")}</p> : null}{row.matchReasons.length ? <p className="outcome-reasons"><b>Match signals:</b> {row.matchReasons.join(" · ")}</p> : null}{row.lastError ? <p className="outcome-conflict"><b>Last system error:</b> {row.lastError}{row.nextCheckAt ? ` · retry ${when(row.nextCheckAt)}` : ""}</p> : null}<ol>{row.checks.map((check) => <li key={`${check.attempt}-${check.checkedAt}`}><b>{when(check.checkedAt)}</b> · {check.provider}{check.httpStatus ? ` · HTTP ${check.httpStatus}` : ""} · {check.state ?? "unknown"} — {check.detail}</li>)}{row.checks.length ? null : <li>No checks recorded yet.</li>}</ol></details>
                  </div>
                ) : null}

                {row.reviewedBy ? <p className="outcome-reviewed">Reviewed by {row.reviewedBy}. A recorded decision is never changed automatically.</p> : null}
              </article>
            );
          })}
          {visibleRows.length > displayedRows.length ? <button className="outcome-load-more" onClick={() => setVisibleLimit((current) => current + 25)} type="button">Show 25 more ({visibleRows.length - displayedRows.length} remaining)</button> : null}
        </div>
      ) : (
        <div className="outcome-empty"><strong>{view === "attention" && queue === "worth_checking" ? "Nothing worthwhile needs your decision" : view === "watching" ? "No listings are currently being watched" : view === "finished" ? "No finished decisions are loaded" : "No listings match this view"}</strong><p>{view === "attention" ? "Try another filter, or wait for stronger evidence from the next outcome check." : "Choose another tab or run an outcome check from System status."}</p></div>
      )}

      {selected.size > 0 ? (
        <div className="scout-bulk-bar outcome-bulk-bar">
          <strong>{selected.size} selected</strong>
          <select aria-label="Optional dismissal reason" onChange={(event) => setBulkDismissReason(event.target.value as DismissalReason)} value={bulkDismissReason}>{DISMISSAL_REASONS.filter((reason) => reason.key !== "unsold" || canBulkMarkUnsolved).map((reason) => <option key={reason.key || "none"} value={reason.key}>{reason.label}</option>)}</select>
          <input onChange={(event) => setBulkNote(event.target.value)} placeholder="Optional note" value={bulkNote} />
          {canBulkWatch ? <button className="is-watch" disabled={bulkSaving || !reviewer.trim()} onClick={() => void decideSelected("keep_watching")} type="button">{bulkSaving ? "Saving…" : "Keep watching"}</button> : null}
          <button className="is-dismiss" disabled={bulkSaving || !reviewer.trim()} onClick={() => void decideSelected(dismissalDecision(bulkDismissReason), dismissalNotes(bulkDismissReason, bulkNote))} type="button">{bulkSaving ? "Saving…" : "Dismiss selected"}</button>
          <button className="is-clear" disabled={bulkSaving} onClick={() => setSelected(new Set())} type="button">Clear</button>
          <small>Dismissal reason and note are optional. Sale verification always stays one listing at a time.</small>
          {!reviewer.trim() ? <small>Add your name above first.</small> : null}
        </div>
      ) : null}
    </section>
  );
}
