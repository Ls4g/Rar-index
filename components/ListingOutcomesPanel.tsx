"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { decisionsFor, sharedDecisionsFor } from "@/lib/listingOutcomeDecisions";

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

function viewFor(row: OutcomeRow): OutcomeView {
  if (row.reviewedBy || ["unsold", "review_complete"].includes(row.status)) return "finished";
  if (row.status === "active") return "watching";
  return "attention";
}

function plainStatus(row: OutcomeRow) {
  switch (row.status) {
    case "sold_candidate": return { label: "Possible sale", help: "eBay reported a completed sale. Check the source and confirm that it is the exact RAR edition." };
    case "ended_pending_check": return { label: "Listing ended", help: "The listing ended, but RAR cannot yet prove whether it sold. Review the source before deciding." };
    case "ambiguous": return { label: "Outcome unclear", help: "RAR found conflicting or incomplete evidence. A human decision is needed." };
    case "inaccessible": return { label: "Could not be checked", help: "eBay no longer provides enough information for RAR to determine the outcome automatically." };
    case "active": return { label: "Still live", help: "No decision is needed while this listing remains active." };
    case "unsold": return { label: "Did not sell", help: "This listing has already been classified as unsold." };
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

export default function ListingOutcomesPanel({ rows, capabilities, counts }: {
  rows: OutcomeRow[];
  capabilities: OutcomeCapability[];
  counts: Record<string, number | string | null>;
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [running, setRunning] = useState(false);
  const [testingEbay, setTestingEbay] = useState(false);
  const [view, setView] = useState<OutcomeView>("attention");
  const [visibleLimit, setVisibleLimit] = useState(25);
  const [bestOfferInputs, setBestOfferInputs] = useState<Record<string, { price: string; currency: string; soldAt: string; confirmed: boolean }>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);

  const canConfirmSales = capabilities.some((capability) => capability.canConfirmSales);
  const viewCounts = rows.reduce<Record<OutcomeView, number>>((totals, row) => {
    totals[viewFor(row)] += 1;
    return totals;
  }, { attention: 0, watching: 0, finished: 0 });
  const visibleRows = rows.filter((row) => viewFor(row) === view);
  const displayedRows = visibleRows.slice(0, visibleLimit);
  // A finished row has already been answered, and the API refuses to overwrite
  // a recorded decision — so it never gets a checkbox in the first place.
  const selectable = view !== "finished";
  const selectableRows = selectable ? displayedRows : [];
  const selectedRows = rows.filter((row) => selected.has(row.id));
  const bulkDecisions = sharedDecisionsFor(selectedRows);

  function toggleSelected(id: string) {
    setSelected((current) => {
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

  function changeView(next: OutcomeView) {
    setView(next);
    setVisibleLimit(25);
    // Selection is per-view. Carrying it across tabs would let a batch act on
    // rows the reviewer can no longer see.
    setSelected(new Set());
  }

  async function decideSelected(decision: string) {
    if (!reviewer.trim()) { setMessage("Add your name or initials first."); return; }
    if (!selectedRows.length) return;
    setBulkSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk-decide",
          outcomeIds: selectedRows.map((row) => row.id),
          decision,
          reviewer,
          notes: bulkNote,
        }),
      });
      const result = await response.json() as { error?: string; saved?: number; savedIds?: string[]; failed?: number; failures?: Array<{ outcomeId: string; error: string }> };
      if (!response.ok) { setMessage(result.error ?? "The decisions could not be saved."); return; }
      const savedIds = new Set(result.savedIds ?? []);
      // Anything that failed stays selected, so a retry does not need the
      // reviewer to work out which ones were missed.
      setSelected((current) => new Set([...current].filter((id) => !savedIds.has(id))));
      if (!result.failed) {
        setBulkNote("");
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

  useEffect(() => {
    const timer = window.setTimeout(() => setReviewer(window.localStorage.getItem("rar_staff_reviewer") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function updateReviewer(value: string) {
    setReviewer(value);
    window.localStorage.setItem("rar_staff_reviewer", value);
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

  async function decide(outcomeId: string, decision: string) {
    if (!reviewer.trim()) { setMessage("Add your name or initials first."); return; }
    setSaving(`${outcomeId}:${decision}`);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcomeId, decision, reviewer, notes: notes[outcomeId] ?? "" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The decision could not be saved.");
      setMessage(decision === "confirm_sale"
        ? "Sale created and verified in one step. It is now in the catalogue evidence."
        : decision === "keep_watching"
          ? "Listing returned to the watch queue. No sale evidence was created."
          : "Decision saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The decision could not be saved.");
    } finally {
      setSaving(null);
    }
  }

  async function testEbayUserAccess() {
    setTestingEbay(true);
    setMessage("");
    try {
      const response = await fetch("/api/listing-outcomes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test-ebay-user-access" }),
      });
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
        body: JSON.stringify({
          action: "record-best-offer-price",
          outcomeId: row.id,
          reviewer,
          notes: notes[row.id] ?? "",
          soldPrice: Number(input.price),
          soldCurrency: input.currency,
          soldAt: input.soldAt,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The Best Offer price could not be saved.");
      setMessage("Accepted Best Offer price recorded as a sold candidate. Confirm the exact edition to publish it as sale evidence.");
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
        <p className="eyebrow">Watched eBay listings</p>
        <h2>Did these listings sell?</h2>
        <p className="section-copy">
          RAR watches live listings and checks them again after they end. You only need to review the uncertain results shown below.
        </p>
      </div>

      <div className="outcome-workspace-summary" aria-label="Listing outcome summary">
        <div className="is-attention"><strong>{viewCounts.attention}</strong><span>Need your decision</span></div>
        <div><strong>{counts.watch_listings_active ?? 0}</strong><span>Still being watched</span></div>
        <div><strong>{counts.watch_confirmed_sales ?? 0}</strong><span>Sales confirmed</span></div>
      </div>
      {counts.watch_next_check_at ? <p className="outcome-next-check">Next outcome check due {when(String(counts.watch_next_check_at))}.</p> : null}

      <div className={`outcome-reviewer-panel${reviewer.trim() ? " is-ready" : ""}`}>
        <div><strong>Before reviewing</strong><p>Enter your name or initials once. RAR adds it to every decision you make.</p></div>
        <label htmlFor="outcome-reviewer">Your reviewer name or initials</label>
        <input id="outcome-reviewer" onChange={(event) => updateReviewer(event.target.value)} placeholder="Example: SP" value={reviewer} />
        <span>{reviewer.trim() ? `Ready — decisions will be recorded as ${reviewer.trim()}.` : "Required before decision buttons can be used."}</span>
      </div>
      {message ? <p className="outcome-message" role="status">{message}</p> : null}

      <div className="outcome-view-tabs" role="tablist" aria-label="Listing outcome views">
        {([[
          "attention", "Needs your decision", viewCounts.attention,
        ], [
          "watching", "Still watching", viewCounts.watching,
        ], [
          "finished", "Finished", viewCounts.finished,
        ]] as Array<[OutcomeView, string, number]>).map(([key, label, count]) => (
          <button aria-selected={view === key} className={view === key ? "is-active" : ""} key={key} onClick={() => changeView(key)} role="tab" type="button">
            {label} <span>{count}</span>
          </button>
        ))}
      </div>

      <details className={`outcome-system-tools${canConfirmSales ? "" : " is-degraded"}`}>
        <summary>{canConfirmSales ? "System status and manual checks" : "System limitation: automatic sale confirmation is unavailable"}</summary>
        <div className="outcome-system-tools-body">
          <p>{canConfirmSales ? "RAR can currently retrieve completed-sale evidence from an authorised provider." : "RAR can detect that a listing disappeared, but it cannot currently prove that it sold. This is why some results need a human decision."}</p>
          <ul>{capabilities.map((capability) => <li key={capability.provider}><b>{capability.provider}:</b> {capability.detail}</li>)}</ul>
          <div className="outcome-actions">
            <button className="outcome-run-button" type="button" disabled={running} onClick={runPipeline}>{running ? "Checking listings…" : "Run outcome checks now"}</button>
            <button type="button" className="secondary-action" disabled={testingEbay} onClick={testEbayUserAccess}>{testingEbay ? "Testing…" : "Test eBay connection"}</button>
          </div>
        </div>
      </details>

      {visibleRows.length && selectable ? (
        <label className="outcome-select-all">
          <input
            checked={selectableRows.length > 0 && selectableRows.every((row) => selected.has(row.id))}
            onChange={toggleSelectAllVisible}
            type="checkbox"
          />
          Select all {selectableRows.length} shown
          {selected.size ? <span> · {selected.size} selected</span> : null}
        </label>
      ) : null}

      {visibleRows.length ? (
        <div className="outcome-list">
          {displayedRows.map((row) => {
            const status = plainStatus(row);
            return (
            <article className={`outcome-card status-${row.status}${selected.has(row.id) ? " is-selected" : ""}`} key={row.id}>
              <div className="outcome-card-head">
                {selectable ? (
                  <input
                    aria-label={`Select ${row.listingTitle}`}
                    checked={selected.has(row.id)}
                    className="outcome-select"
                    onChange={() => toggleSelected(row.id)}
                    type="checkbox"
                  />
                ) : null}
                {row.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- marketplace CDN, not a configured next/image host */
                  <img alt="" className="outcome-thumb" loading="lazy" src={row.imageUrl} />
                ) : null}
                <div>
                  <span className={`coverage-pill status-${row.status}`}>{status.label}</span>
                  <h3>{row.listingTitle}</h3>
                  <p className="outcome-edition">
                    {row.editionLabel}
                  </p>
                </div>
              </div>

              <div className="outcome-human-prompt">
                <strong>{row.status === "active" ? "What happens next" : row.reviewedBy ? "Decision recorded" : "What you need to decide"}</strong>
                <p>{status.help}</p>
                <div className="outcome-source-links">
                  <a href={row.sourceListingUrl} rel="noreferrer" target="_blank">Open original eBay listing ↗</a>
                  <a href={`/edition/${row.editionId}`}>Open RAR edition</a>
                  {row.profileId ? <a href={`/collection-profiles/${row.profileId}`}>Open search profile</a> : null}
                  {row.observationId ? <a href={`/review?observation=${row.observationId}`}>Open resulting sale</a> : null}
                </div>
              </div>

              <dl className="outcome-facts">
                <div><dt>Reported sale</dt><dd>{money(row.soldPrice, row.soldCurrency)}</dd></div>
                <div><dt>Sold / ended</dt><dd>{when(row.soldAt ?? row.scheduledEndAt)}</dd></div>
                <div><dt>Asking price when seen</dt><dd>{money(row.askingPrice, row.currency)}</dd></div>
                <div><dt>Match</dt><dd>{row.matchScore ?? "—"}{row.matchConfidence ? ` · ${row.matchConfidence}` : ""}</dd></div>
              </dl>

              {row.outcomeReason ? <p className="outcome-evidence"><b>Evidence:</b> {row.outcomeReason}</p> : null}
              {!row.reviewedBy
                && row.soldPrice === null
                && (row.buyingFormat ?? "").toUpperCase().includes("OFFER")
                && ["ended_pending_check", "ambiguous", "inaccessible"].includes(row.status) ? (
                <div className="best-offer-corroboration">
                  <div>
                    <strong>Best Offer price unresolved</strong>
                    <p>Search 130point using the exact eBay item number below. This only supplies the hidden accepted price; eBay remains the original sale source.</p>
                  </div>
                  <div className="best-offer-tools">
                    <code>{row.externalId}</code>
                    <button
                      className="secondary-action"
                      onClick={() => void navigator.clipboard.writeText(row.externalId).then(() => setMessage(`Copied eBay item ${row.externalId}.`))}
                      type="button"
                    >
                      Copy item number
                    </button>
                    <a className="secondary-action" href="https://130point.com/sales/" rel="noreferrer" target="_blank">Open 130point ↗</a>
                  </div>
                  <div className="best-offer-fields">
                    <label>Accepted price<input inputMode="decimal" min="0.01" onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { currency: row.currency ?? "USD", soldAt: "", confirmed: false }), price: event.target.value } }))} placeholder="0.00" step="0.01" type="number" value={bestOfferInputs[row.id]?.price ?? ""} /></label>
                    <label>Currency<select onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { price: "", soldAt: "", confirmed: false }), currency: event.target.value } }))} value={bestOfferInputs[row.id]?.currency ?? row.currency ?? "USD"}><option value="USD">USD</option><option value="GBP">GBP</option><option value="EUR">EUR</option><option value="JPY">JPY</option><option value="CAD">CAD</option><option value="AUD">AUD</option></select></label>
                    <label>Sale date<input max={new Date().toISOString().slice(0, 10)} onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { price: "", currency: row.currency ?? "USD", confirmed: false }), soldAt: event.target.value } }))} type="date" value={bestOfferInputs[row.id]?.soldAt ?? ""} /></label>
                  </div>
                  <label className="best-offer-confirm"><input checked={bestOfferInputs[row.id]?.confirmed ?? false} onChange={(event) => setBestOfferInputs((current) => ({ ...current, [row.id]: { ...(current[row.id] ?? { price: "", currency: row.currency ?? "USD", soldAt: "" }), confirmed: event.target.checked } }))} type="checkbox" /> I matched this exact eBay item number in 130point.</label>
                  <button className="catalogue-bulk-approve" disabled={Boolean(saving)} onClick={() => void recordBestOfferPrice(row)} type="button">{saving === `${row.id}:best-offer` ? "Saving…" : "Save as sold candidate"}</button>
                </div>
              ) : null}

              <details className="outcome-history">
                <summary>Technical details and check history ({row.checkAttempts})</summary>
                <dl className="outcome-technical-facts">
                  <div><dt>Listing format</dt><dd>{row.buyingFormat?.replaceAll("_", " ").toLowerCase() ?? "—"}{row.bidCount !== null ? ` · ${row.bidCount} bids` : ""}</dd></div>
                  <div><dt>First watched</dt><dd>{when(row.firstSeenAt)}</dd></div>
                  <div><dt>Last seen live</dt><dd>{when(row.lastSeenAt)}</dd></div>
                  <div><dt>eBay item number</dt><dd>{row.externalId}</dd></div>
                </dl>
                {row.matchConflicts.length ? <p className="outcome-conflict"><b>Match conflicts:</b> {row.matchConflicts.join("; ")}</p> : null}
                {row.matchReasons.length ? <p className="outcome-reasons"><b>Match signals:</b> {row.matchReasons.join(" · ")}</p> : null}
                {row.lastError ? <p className="outcome-conflict"><b>Last system error:</b> {row.lastError}{row.nextCheckAt ? ` · retry ${when(row.nextCheckAt)}` : ""}</p> : null}
                <ol>
                  {row.checks.map((check) => (
                    <li key={`${check.attempt}-${check.checkedAt}`}>
                      <b>{when(check.checkedAt)}</b> · {check.provider}{check.httpStatus ? ` · HTTP ${check.httpStatus}` : ""} · {check.state ?? "unknown"} — {check.detail}
                    </li>
                  ))}
                  {row.checks.length ? null : <li>No checks recorded yet.</li>}
                </ol>
              </details>

              {row.reviewedBy ? (
                <p className="outcome-reviewed">Reviewed by {row.reviewedBy}. A recorded decision is never changed automatically.</p>
              ) : (
                <>
                  {row.status === "active" ? <p className="outcome-evidence"><b>Still live:</b> no sale decision is available until eBay reports that this listing ended.</p> : null}
                  <label className="outcome-note">Note (optional)<input onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Only if something needs saying" value={notes[row.id] ?? ""} /></label>
                  <div className="outcome-decisions">
                    {decisionsFor(row).map((decision) => (
                      <button
                        className={decision.tone === "primary" ? "catalogue-bulk-approve" : decision.tone === "watch" ? "outcome-keep-watching" : "secondary-action"}
                        disabled={!reviewer.trim() || Boolean(saving)}
                        key={decision.key}
                        onClick={() => void decide(row.id, decision.key)}
                        type="button"
                      >
                        {saving === `${row.id}:${decision.key}` ? "Saving…" : decision.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </article>
          );})}
          {visibleRows.length > displayedRows.length ? (
            <button className="outcome-load-more" onClick={() => setVisibleLimit((current) => current + 25)} type="button">
              Show 25 more ({visibleRows.length - displayedRows.length} remaining)
            </button>
          ) : null}
        </div>
      ) : (
        <div className="outcome-empty">
          <strong>{view === "attention" ? "Nothing needs your decision" : view === "watching" ? "No listings are currently being watched" : "No finished decisions are loaded"}</strong>
          <p>{view === "attention" ? "You are caught up. RAR will place uncertain outcomes here after the next check." : "Choose another tab or run an outcome check from System status."}</p>
        </div>
      )}

      {/* Same sticky bar Scout triage uses, deliberately — a staff member who
          has learned one bulk workflow should not have to learn a second. */}
      {selected.size > 0 ? (
        <div className="scout-bulk-bar outcome-bulk-bar">
          <strong>{selected.size} selected</strong>
          <input onChange={(event) => setBulkNote(event.target.value)} placeholder="Optional note for all selected" value={bulkNote} />
          {bulkDecisions.map((decision) => (
            <button
              className={decision.tone === "watch" ? "is-watch" : decision.key === "dismiss" ? "is-dismiss" : "is-clear"}
              disabled={bulkSaving || !reviewer.trim()}
              key={decision.key}
              onClick={() => void decideSelected(decision.key)}
              type="button"
            >
              {bulkSaving ? "Saving…" : decision.label}
            </button>
          ))}
          <button className="is-clear" disabled={bulkSaving} onClick={() => setSelected(new Set())} type="button">Clear</button>
          {/* Said plainly rather than left as a silently missing button. */}
          {selectedRows.some((row) => decisionsFor(row).some((decision) => decision.key === "confirm_sale")) ? (
            <small>Verifying a sale stays one at a time, so the exact edition can be checked.</small>
          ) : null}
          {!bulkDecisions.length ? <small>No decision applies to every selected listing. Narrow the selection.</small> : null}
          {!reviewer.trim() ? <small>Add your name above first.</small> : null}
        </div>
      ) : null}
    </section>
  );
}
