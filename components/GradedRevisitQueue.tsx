"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

export type GradedRevisitLead = {
  id: string;
  editionId: string | null;
  editionTitle: string;
  reviewStatus: "dismissed" | "watching" | "new";
  pending: boolean;
  originalNote: string | null;
};

export type GradedRevisitGroup = {
  key: string;
  title: string;
  url: string;
  price: number | null;
  currency: string | null;
  lastSeenAt: string;
  outcomeStatus: string | null;
  recordedSaleEditionId: string | null;
  leads: GradedRevisitLead[];
};

function priceLabel(price: number | null, currency: string | null) {
  if (price === null || !currency) return "No asking price saved";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 2 }).format(price);
  } catch {
    return `${price} ${currency}`;
  }
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function outcomeLabel(status: string | null) {
  const labels: Record<string, string> = {
    active: "Outcome tracker: active",
    ended_pending_check: "Outcome tracker: checking status",
    ambiguous: "Outcome tracker: uncertain",
    inaccessible: "Outcome tracker: inaccessible",
    unsold: "Outcome tracker: marked unsold",
    sold_candidate: "Outcome tracker: sold candidate",
    review_complete: "Outcome tracker: reviewed",
  };
  return status ? labels[status] ?? `Outcome tracker: ${status}` : "Not in outcome tracker";
}

export default function GradedRevisitQueue({ initialGroups }: { initialGroups: GradedRevisitGroup[] }) {
  const [groups, setGroups] = useState(initialGroups);
  const [view, setView] = useState<"pending" | "reviewed">("pending");
  const [reviewer, setReviewer] = useStaffReviewer();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const pendingCount = groups.reduce((total, group) => total + group.leads.filter((lead) => lead.pending).length, 0);
  const visibleGroups = useMemo(() => groups.filter((group) => group.leads.some((lead) => view === "pending" ? lead.pending : !lead.pending)), [groups, view]);

  async function decide(leadId: string, disposition: "watching" | "dismissed") {
    if (!reviewer.trim()) {
      setMessage("Enter your name or initials before saving a decision.");
      return;
    }
    setSavingId(leadId);
    setMessage("");
    try {
      const response = await fetch("/api/graded-revisit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, disposition, reviewer: reviewer.trim(), notes: notes[leadId] ?? "" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "This decision could not be saved.");
      setGroups((current) => current.map((group) => ({
        ...group,
        leads: group.leads.map((lead) => lead.id === leadId
          ? { ...lead, pending: false, reviewStatus: disposition }
          : lead),
      })));
      setMessage(disposition === "watching" ? "Reopened in Scout. The original graded dismissal remains in the audit history." : "Kept archived. The re-review decision was recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This decision could not be saved.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <section className="graded-revisit-workspace" aria-label="Graded listing re-review queue">
      <div className="graded-revisit-toolbar">
        <div className="graded-revisit-tabs" role="group" aria-label="Queue view">
          <button aria-pressed={view === "pending"} onClick={() => setView("pending")} type="button">To revisit · {pendingCount}</button>
          <button aria-pressed={view === "reviewed"} onClick={() => setView("reviewed")} type="button">Already revisited · {groups.reduce((n, group) => n + group.leads.filter((lead) => !lead.pending).length, 0)}</button>
        </div>
        <label className="graded-revisit-reviewer">Reviewer name or initials
          <input autoComplete="name" onChange={(event) => setReviewer(event.target.value)} placeholder="Enter once" value={reviewer} />
        </label>
      </div>
      {message ? <p aria-live="polite" className="graded-revisit-message">{message}</p> : null}
      {visibleGroups.length === 0 ? <p className="graded-revisit-empty">No listings in this view.</p> : null}
      <div className="graded-revisit-list">
        {visibleGroups.map((group) => (
          <article className="graded-revisit-card" key={group.key}>
            <div className="graded-revisit-card-top">
              <div>
                <p className="eyebrow">Graded listing · asking price, not sale data</p>
                <h2>{group.title}</h2>
                <p>{priceLabel(group.price, group.currency)} · last seen by Scout {dateLabel(group.lastSeenAt)}</p>
              </div>
              <a className="graded-revisit-source" href={group.url} rel="noreferrer" target="_blank">Open original eBay listing ↗</a>
            </div>
            <p className="graded-revisit-outcome">{group.recordedSaleEditionId
              ? "A verified sale has already been recorded for this eBay listing. It has left the revisit queue."
              : `${outcomeLabel(group.outcomeStatus)}. A missing or uncertain outcome is not proof of a sale.`}</p>
            {group.leads.filter((lead) => view === "pending" ? lead.pending : !lead.pending).map((lead) => (
              <div className="graded-revisit-edition" key={lead.id}>
                <div>
                  <strong>{lead.editionId ? <Link href={`/edition/${lead.editionId}`} target="_blank">{lead.editionTitle} ↗</Link> : lead.editionTitle}</strong>
                  <small>Original decision: dismissed as graded{lead.originalNote ? ` · ${lead.originalNote}` : ""}</small>
                </div>
                <div className="graded-revisit-actions">
                  {!group.recordedSaleEditionId && lead.editionId ? <Link className="graded-revisit-sale" href={`/add-sale?gradedLeadId=${encodeURIComponent(lead.id)}#graded-approved-sale`}>Record graded sale →</Link> : null}
                  {lead.pending ? <>
                    <input aria-label={`Optional note for ${lead.editionTitle}`} onChange={(event) => setNotes((current) => ({ ...current, [lead.id]: event.target.value }))} placeholder="Optional note for Scout decision" value={notes[lead.id] ?? ""} />
                    <button disabled={savingId !== null || group.outcomeStatus === "unsold" || group.outcomeStatus === "review_complete"} onClick={() => decide(lead.id, "watching")} type="button">Reopen in Scout if still live</button>
                    <button disabled={savingId !== null} onClick={() => decide(lead.id, "dismissed")} type="button">Keep archived</button>
                  </> : <span className="graded-revisit-done">{group.recordedSaleEditionId
                    ? lead.editionId === group.recordedSaleEditionId ? "Sale recorded for this edition" : "Sale recorded for another edition"
                    : lead.reviewStatus === "watching" ? "Reopened in Scout" : "Kept archived"}</span>}
                </div>
              </div>
            ))}
          </article>
        ))}
      </div>
      <p className="graded-revisit-footer">Record graded sale opens the existing one-step sales form with this listing and edition filled in. Confirm the completed sale, actual paid price and exact grade there. The saved asking price is never used as a sale price.</p>
    </section>
  );
}
