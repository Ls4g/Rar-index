"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SaleDecision = {
  observationId: string;
  listingTitle: string;
  sourceUrl: string;
  soldDate: string | null;
  price: number;
  currency: string;
  editionLabel: string;
  reason: string | null;
};

type PrintDecision = {
  actionId: string;
  observationId: string;
  listingTitle: string;
  sourceUrl: string;
  editionLabel: string;
  classification: "known_later_print" | "first_print_proven";
  proofUrl: string;
  printingNumber: number | null;
  rationale: string;
  confidence: number | null;
};

type CatalogueDecision = {
  id: string;
  title: string;
  series: string | null;
  volumeNumber: string | null;
  author: string | null;
  publisher: string | null;
  language: string | null;
  isbn13: string | null;
  releaseDate: string | null;
  sourceName: string | null;
  sourceUrl: string;
  isEditionCandidate: boolean;
  reviewMetadata: Record<string, string | null>;
};

type AgentProposal = {
  id: string;
  agentKey: string;
  actionType: string;
  title: string;
  rationale: string;
  confidence: number | null;
  destination: string | null;
  canExecute: boolean;
};

type DecisionKind = "sale" | "printing" | "catalogue" | "proposal";
type Banner = { tone: "ok" | "error"; text: string };

function DecisionNote({ value, reason, onChange, onReasonChange }: { value: string; reason: string; onChange: (value: string) => void; onReasonChange: (value: string) => void }) {
  return (
    <details className="human-decision-note">
      <summary>Give the agent a reason (optional)</summary>
      <label><span>Reason</span><select onChange={(event) => onReasonChange(event.target.value)} value={reason}><option value="">Choose only if useful</option><option value="exact_match">Exact match</option><option value="wrong_edition">Wrong edition</option><option value="insufficient_evidence">Not enough evidence</option><option value="source_problem">Source problem</option><option value="workflow_problem">Workflow problem</option><option value="other">Other</option></select></label>
      <label><span>Extra note</span><textarea maxLength={500} onChange={(event) => onChange(event.target.value)} placeholder="Anything else the agent should learn?" rows={2} value={value} /></label>
    </details>
  );
}

function formatPrice(price: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(price);
}

function confidenceLabel(value: number | null) {
  return value === null ? "Confidence not scored" : `${Math.round(value * 100)}% confidence`;
}

export default function HumanDecisionInbox({
  sales,
  printing,
  catalogue,
  proposals,
}: {
  sales: SaleDecision[];
  printing: PrintDecision[];
  catalogue: CatalogueDecision[];
  proposals: AgentProposal[];
}) {
  const [reviewer, setReviewer] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("rar_staff_reviewer") ?? "");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [filter, setFilter] = useState<"all" | DecisionKind>("all");

  useEffect(() => {
    if (reviewer.trim()) window.sessionStorage.setItem("rar_staff_reviewer", reviewer.trim());
  }, [reviewer]);

  const visibleSales = sales.filter((item) => !resolved.has(`sale:${item.observationId}`));
  const visiblePrinting = printing.filter((item) => !resolved.has(`printing:${item.actionId}`));
  const visibleCatalogue = catalogue.filter((item) => !resolved.has(`catalogue:${item.id}`));
  const visibleProposals = proposals.filter((item) => !resolved.has(`proposal:${item.id}`));
  // Confidence controls prioritisation only. A human still makes every
  // verification decision, including suggestions that eventually score 90%+.
  const highConfidenceProposals = visibleProposals.filter((item) => item.confidence !== null && item.confidence >= 0.9);
  const learningProposals = visibleProposals.filter((item) => item.confidence === null || item.confidence < 0.9);

  const counts = {
    all: visibleSales.length + visiblePrinting.length + visibleCatalogue.length + highConfidenceProposals.length,
    sale: visibleSales.length,
    printing: visiblePrinting.length,
    catalogue: visibleCatalogue.length,
    proposal: highConfidenceProposals.length,
  };

  function canShow(kind: DecisionKind) {
    return filter === "all" || filter === kind;
  }

  async function request(key: string, url: string, body: Record<string, unknown>) {
    if (!reviewer.trim()) {
      setBanner({ tone: "error", text: "Enter your name or initials once before making decisions." });
      return false;
    }
    setBusyKeys((current) => new Set([...current, key]));
    setBanner(null);
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, reviewer: reviewer.trim() }) });
      const result = await response.json() as { error?: string; message?: string };
      if (!response.ok) {
        setBanner({ tone: "error", text: result.error ?? "The decision could not be saved." });
        return false;
      }
      setResolved((current) => new Set([...current, key]));
      setDecisionNotes((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setDecisionReasons((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setBanner({ tone: "ok", text: result.message ?? "Decision saved. The item has left your inbox and the audit trail was updated." });
      return true;
    } catch {
      setBanner({ tone: "error", text: "The decision could not be saved. Check the connection and try again." });
      return false;
    } finally {
      setBusyKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function decideSale(item: SaleDecision, accepted: boolean) {
    const key = `sale:${item.observationId}`;
    await request(key, "/api/review", {
      observationIds: [item.observationId],
      decision: accepted ? "verified_match" : "excluded",
      notes: decisionNotes[key] ?? "",
      feedbackReason: decisionReasons[key] ?? "",
    });
  }

  async function decidePrinting(item: PrintDecision, accepted: boolean) {
    const key = `printing:${item.actionId}`;
    if (!accepted) {
      await request(key, "/api/agents", { command: "review_action", actionId: item.actionId, decision: "rejected", notes: decisionNotes[key] ?? "", feedbackReason: decisionReasons[key] ?? "" });
      return;
    }
    await request(key, "/api/print-classification", {
      observationIds: [item.observationId],
      classification: item.classification,
      proofUrl: item.proofUrl,
      printingNumber: item.printingNumber?.toString() ?? "",
      notes: decisionNotes[key] ?? "",
      suggestionActionId: item.actionId,
      feedbackReason: decisionReasons[key] ?? "",
    });
  }

  async function decideCatalogue(item: CatalogueDecision, accepted: boolean) {
    const key = `catalogue:${item.id}`;
    await request(key, "/api/catalogue-review", {
      catalogueImportId: item.id,
      decision: accepted ? "approve_new" : "rejected",
      notes: decisionNotes[key] ?? "",
      metadata: {
        title: item.title,
        series: item.series,
        volumeNumber: item.volumeNumber,
        author: item.author,
        publisher: item.publisher,
        language: item.language,
        isbn13: item.isbn13,
        releaseDate: item.releaseDate,
        ...item.reviewMetadata,
      },
      feedbackReason: decisionReasons[key] ?? "",
    });
  }

  async function decideProposal(item: AgentProposal, accepted: boolean) {
    const key = `proposal:${item.id}`;
    await request(key, "/api/agents", {
      command: "review_action",
      actionId: item.id,
      decision: accepted ? "approved" : "rejected",
      execute: accepted && item.canExecute,
      notes: decisionNotes[key] ?? "",
      feedbackReason: decisionReasons[key] ?? "",
    });
  }

  const empty = counts.all === 0;

  return (
    <div className="human-decision-inbox">
      <div className="human-decision-toolbar">
        <label><span>Reviewer</span><input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" value={reviewer} /></label>
        <p>Type this once. Every yes/no decision is recorded and becomes labelled feedback for the agents.</p>
      </div>

      {banner ? <p className={`human-decision-banner is-${banner.tone}`} role="status">{banner.text}</p> : null}

      <nav className="human-decision-filters" aria-label="Decision categories">
        {(["all", "sale", "printing", "catalogue", "proposal"] as const).map((kind) => (
          <button aria-pressed={filter === kind} key={kind} onClick={() => setFilter(kind)} type="button">
            {kind === "all" ? "All decisions" : kind === "sale" ? "Sales" : kind === "printing" ? "Printing" : kind === "catalogue" ? "Catalogue" : "Agent plans"}
            <span>{counts[kind]}</span>
          </button>
        ))}
      </nav>

      {empty ? <div className="review-empty"><strong>No human input is needed.</strong><p>The agents can continue preparing work in the background.</p></div> : null}

      {canShow("sale") && visibleSales.map((item) => (
        <article className="human-decision-card" key={item.observationId}>
          <div className="human-decision-question"><span>Market Scout asks</span><h2>Does this completed sale match the proposed edition?</h2></div>
          <div className="human-decision-facts"><strong>{formatPrice(item.price, item.currency)}</strong><span>{item.soldDate ?? "Sale date not recorded"}</span><p>{item.listingTitle}</p><b>{item.editionLabel}</b>{item.reason ? <small>{item.reason}</small> : null}</div>
          <DecisionNote reason={decisionReasons[`sale:${item.observationId}`] ?? ""} value={decisionNotes[`sale:${item.observationId}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`sale:${item.observationId}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`sale:${item.observationId}`]: value }))} />
          <div className="human-decision-actions">
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">Check source ↗</a>
            <button disabled={busyKeys.has(`sale:${item.observationId}`)} onClick={() => void decideSale(item, true)} type="button">{busyKeys.has(`sale:${item.observationId}`) ? "Saving…" : "Yes — verify"}</button>
            <button className="is-no" disabled={busyKeys.has(`sale:${item.observationId}`)} onClick={() => void decideSale(item, false)} type="button">No — exclude</button>
          </div>
        </article>
      ))}

      {canShow("printing") && visiblePrinting.map((item) => (
        <article className="human-decision-card" key={item.actionId}>
          <div className="human-decision-question"><span>Evidence Auditor asks · {confidenceLabel(item.confidence)}</span><h2>{item.classification === "first_print_proven" ? "Does this image prove a first printing?" : "Does this image prove a later printing?"}</h2></div>
          <div className="human-decision-facts"><p>{item.listingTitle}</p><b>{item.editionLabel}</b><small>{item.rationale}</small></div>
          <DecisionNote reason={decisionReasons[`printing:${item.actionId}`] ?? ""} value={decisionNotes[`printing:${item.actionId}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`printing:${item.actionId}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`printing:${item.actionId}`]: value }))} />
          <div className="human-decision-actions">
            <a href={item.proofUrl || item.sourceUrl} target="_blank" rel="noreferrer">Check proof ↗</a>
            <button disabled={busyKeys.has(`printing:${item.actionId}`) || !item.proofUrl} onClick={() => void decidePrinting(item, true)} type="button">{busyKeys.has(`printing:${item.actionId}`) ? "Saving…" : "Yes — apply"}</button>
            <button className="is-no" disabled={busyKeys.has(`printing:${item.actionId}`)} onClick={() => void decidePrinting(item, false)} type="button">No — dismiss</button>
          </div>
        </article>
      ))}

      {canShow("catalogue") && visibleCatalogue.map((item) => (
        <article className="human-decision-card" key={item.id}>
          <div className="human-decision-question"><span>Catalogue Curator asks</span><h2>Is this a real physical edition RAR should add?</h2></div>
          <div className="human-decision-facts"><p>{item.title}</p><b>{[item.series, item.volumeNumber ? `Vol. ${item.volumeNumber}` : null, item.language].filter(Boolean).join(" · ")}</b><small>{[item.publisher, item.isbn13 ? `ISBN ${item.isbn13}` : null, item.releaseDate].filter(Boolean).join(" · ")}</small></div>
          <DecisionNote reason={decisionReasons[`catalogue:${item.id}`] ?? ""} value={decisionNotes[`catalogue:${item.id}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`catalogue:${item.id}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`catalogue:${item.id}`]: value }))} />
          <div className="human-decision-actions">
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">Check source ↗</a>
            {item.isEditionCandidate ? <button disabled={busyKeys.has(`catalogue:${item.id}`)} onClick={() => void decideCatalogue(item, true)} type="button">{busyKeys.has(`catalogue:${item.id}`) ? "Saving…" : "Yes — add edition"}</button> : <Link href="/catalogue-review">Needs detailed review →</Link>}
            <button className="is-no" disabled={busyKeys.has(`catalogue:${item.id}`)} onClick={() => void decideCatalogue(item, false)} type="button">No — reject</button>
          </div>
        </article>
      ))}

      {canShow("proposal") && highConfidenceProposals.map((item) => (
        <article className="human-decision-card is-plan" key={item.id}>
          <div className="human-decision-question"><span>{item.agentKey.replaceAll("_", " ")} asks · {confidenceLabel(item.confidence)}</span><h2>Should RAR act on this recommendation?</h2></div>
          <div className="human-decision-facts"><p>{item.title}</p><small>{item.rationale}</small>{item.canExecute ? <b>Ready to run immediately after approval.</b> : <b>Approval records permission only; execution is not automated yet.</b>}</div>
          <DecisionNote reason={decisionReasons[`proposal:${item.id}`] ?? ""} value={decisionNotes[`proposal:${item.id}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`proposal:${item.id}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`proposal:${item.id}`]: value }))} />
          <div className="human-decision-actions">
            {item.destination ? <Link href={item.destination}>Inspect related work →</Link> : null}
            <button disabled={busyKeys.has(`proposal:${item.id}`)} onClick={() => void decideProposal(item, true)} type="button">{busyKeys.has(`proposal:${item.id}`) ? item.canExecute ? "Running…" : "Saving…" : item.canExecute ? "Approve and run" : "Approve plan"}</button>
            <button className="is-no" disabled={busyKeys.has(`proposal:${item.id}`)} onClick={() => void decideProposal(item, false)} type="button">No — dismiss</button>
          </div>
        </article>
      ))}

      {canShow("proposal") && learningProposals.length ? (
        <details className="human-learning-queue">
          <summary>{learningProposals.length} lower-confidence recommendation{learningProposals.length === 1 ? "" : "s"} kept out of the main inbox</summary>
          <p>These remain available for training and investigation, but they do not consume the normal decision queue until they reach 90% confidence.</p>
          <ul>{learningProposals.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{confidenceLabel(item.confidence)}</span>{item.destination ? <Link href={item.destination}>Inspect →</Link> : null}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
