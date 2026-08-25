"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type OutcomeRow = {
  id: string;
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

const DECISIONS: Array<{ key: string; label: string; tone?: string }> = [
  { key: "confirm_sale", label: "Confirm sale and exact edition", tone: "primary" },
  { key: "mark_unsold", label: "Mark unsold" },
  { key: "wrong_edition", label: "Wrong edition" },
  { key: "mark_ambiguous", label: "Ambiguous" },
  { key: "dismiss", label: "Dismiss" },
];

function decisionsFor(row: OutcomeRow) {
  return DECISIONS.filter((decision) => {
    if (decision.key === "confirm_sale") {
      return row.status === "sold_candidate" && row.soldPrice !== null && Boolean(row.soldCurrency && row.soldAt);
    }
    if (decision.key === "mark_unsold" && row.status === "active") return false;
    return true;
  });
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

  const canConfirmSales = capabilities.some((capability) => capability.canConfirmSales);

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
      setMessage(decision === "confirm_sale" ? "Sale created and verified in one step. It is now in the catalogue evidence." : "Decision saved.");
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

  return (
    <section className="listing-outcomes">
      <div className="section-intro">
        <p className="eyebrow">Watch to sale</p>
        <h2>Listing outcomes</h2>
        <p className="section-copy">
          Listings Scout saw live, revisited after they end. A listing that disappeared did not necessarily sell, and nothing here becomes evidence without the confirm action below.
        </p>
      </div>

      <div className="outcome-counts">
        {[
          ["Watching", counts.watch_listings_active],
          ["Awaiting end", counts.watch_awaiting_end],
          ["Checks due", counts.watch_checks_due],
          ["Sold candidates", counts.watch_sold_candidates],
          ["Confirmed sales", counts.watch_confirmed_sales],
          ["Unsold", counts.watch_unsold],
          ["Ambiguous", counts.watch_ambiguous],
          ["Inaccessible", counts.watch_inaccessible],
          ["API failures", counts.watch_api_failures],
        ].map(([label, value]) => (
          <div key={String(label)}><strong>{value ?? 0}</strong><span>{label}</span></div>
        ))}
      </div>
      {counts.watch_next_check_at ? <p className="outcome-next-check">Next outcome check due {when(String(counts.watch_next_check_at))}.</p> : null}

      {/* A degraded integration is stated rather than left to be inferred from
          an empty queue. Without a sold-capable provider this pipeline is
          working correctly when it produces nothing. */}
      <div className={`outcome-capabilities${canConfirmSales ? "" : " is-degraded"}`}>
        <strong>{canConfirmSales ? "Sale confirmation available" : "Sale confirmation unavailable — pipeline is degraded"}</strong>
        <ul>
          {capabilities.map((capability) => (
            <li key={capability.provider}>
              <span className={capability.available ? "ok" : "off"}>{capability.available ? "✓" : "✕"}</span>
              <b>{capability.provider}</b> {capability.detail}
            </li>
          ))}
        </ul>
        {canConfirmSales ? null : <p>Outcome checks still run and are recorded, but no listing can become a sold candidate until a provider that reports completed sales is authorised. Listings will resolve as ambiguous or inaccessible, which is the correct result rather than a failure.</p>}
      </div>

      <div className="outcome-actions">
        <label>Reviewer<input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" value={reviewer} /></label>
        <button type="button" disabled={running} onClick={runPipeline}>{running ? "Running…" : "Run outcome checks"}</button>
        <button type="button" className="secondary-action" disabled={testingEbay} onClick={testEbayUserAccess}>{testingEbay ? "Testing…" : "Test eBay account access"}</button>
      </div>
      {message ? <p className="outcome-message" role="status">{message}</p> : null}

      {rows.length ? (
        <div className="outcome-list">
          {rows.map((row) => (
            <article className={`outcome-card status-${row.status}`} key={row.id}>
              <div className="outcome-card-head">
                {row.imageUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- marketplace CDN, not a configured next/image host */
                  <img alt="" className="outcome-thumb" loading="lazy" src={row.imageUrl} />
                ) : null}
                <div>
                  <span className={`coverage-pill status-${row.status}`}>{row.status.replaceAll("_", " ")}</span>
                  <h3>{row.listingTitle}</h3>
                  <p className="outcome-edition">
                    {row.editionLabel} · <a href={`/edition/${row.editionId}`}>edition</a>
                    {row.profileId ? <> · <a href={`/collection-profiles/${row.profileId}`}>search profile</a></> : null}
                    {row.observationId ? <> · <a href={`/review?observation=${row.observationId}`}>resulting sale</a></> : null}
                  </p>
                </div>
              </div>

              <dl className="outcome-facts">
                <div><dt>Reported sale</dt><dd>{money(row.soldPrice, row.soldCurrency)}</dd></div>
                <div><dt>Sold / ended</dt><dd>{when(row.soldAt ?? row.scheduledEndAt)}</dd></div>
                <div><dt>Asking price when seen</dt><dd>{money(row.askingPrice, row.currency)}</dd></div>
                <div><dt>Format</dt><dd>{row.buyingFormat?.replaceAll("_", " ").toLowerCase() ?? "—"}{row.bidCount !== null ? ` · ${row.bidCount} bids` : ""}</dd></div>
                <div><dt>Watched from</dt><dd>{when(row.firstSeenAt)}</dd></div>
                <div><dt>Match</dt><dd>{row.matchScore ?? "—"}{row.matchConfidence ? ` · ${row.matchConfidence}` : ""}</dd></div>
              </dl>

              {row.outcomeReason ? <p className="outcome-evidence"><b>Evidence:</b> {row.outcomeReason}</p> : null}
              {row.matchConflicts.length ? <p className="outcome-conflict"><b>Conflicts:</b> {row.matchConflicts.join("; ")}</p> : null}
              {row.matchReasons.length ? <p className="outcome-reasons">{row.matchReasons.join(" · ")}</p> : null}
              {row.lastError ? <p className="outcome-conflict"><b>Last error:</b> {row.lastError}{row.nextCheckAt ? ` · retry ${when(row.nextCheckAt)}` : ""}</p> : null}

              <details className="outcome-history">
                <summary>Outcome check history ({row.checkAttempts} attempt{row.checkAttempts === 1 ? "" : "s"}) and original snapshot</summary>
                <ol>
                  {row.checks.map((check) => (
                    <li key={`${check.attempt}-${check.checkedAt}`}>
                      <b>{when(check.checkedAt)}</b> · {check.provider}{check.httpStatus ? ` · HTTP ${check.httpStatus}` : ""} · {check.state ?? "unknown"} — {check.detail}
                    </li>
                  ))}
                  {row.checks.length ? null : <li>No checks recorded yet.</li>}
                </ol>
                <p><a href={row.sourceListingUrl} rel="noreferrer" target="_blank">Original listing ↗</a> · first seen {when(row.firstSeenAt)}, last seen live {when(row.lastSeenAt)}</p>
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
                        className={decision.tone === "primary" ? "catalogue-bulk-approve" : "secondary-action"}
                        disabled={Boolean(saving)}
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
          ))}
        </div>
      ) : (
        <p className="outcome-empty">No listing outcomes recorded yet. Run the outcome checks to start watching the listings Scout has already found.</p>
      )}
    </section>
  );
}
