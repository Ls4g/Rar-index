"use client";
/* eslint-disable @next/next/no-img-element -- staff-only cover candidates use external source URLs */

import Link from "next/link";
import { useState } from "react";
import OutcomeSaleConfirmationForm from "@/components/OutcomeSaleConfirmationForm";
import type { OutcomeSaleConfirmation } from "@/lib/outcomeSaleConfirmation";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

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
  // Why this candidate cannot be approved straight from the inbox, or null when
  // it can. Computed on the server with the same guards the catalogue API
  // enforces, so the inbox never offers an approval the server would refuse.
  approvalBlocker: string | null;
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

type CoverDecision = {
  id: string;
  editionId: string;
  editionLabel: string;
  imageUrl: string;
  sourceUrl: string;
  sourceName: string;
  candidateTitle: string | null;
  score: number;
  reasons: string[];
};

type ListingOutcomeDecision = {
  buyingFormat: string | null;
  outcomeProvider: string | null;
  id: string;
  status: string;
  editionLabel: string;
  listingTitle: string;
  sourceUrl: string;
  price: number | null;
  currency: string | null;
  soldAt: string | null;
  score: number | null;
};

type GradingConflictDecision = {
  observationId: string;
  listingTitle: string;
  sourceUrl: string;
  soldDate: string | null;
  price: number | null;
  currency: string | null;
  gradingCompany: string | null;
  gradeLabel: string | null;
  editionLabel: string;
};

type CommunityDecision = {
  id: string;
  reportType: string;
  editionLabel: string;
  sourceUrl: string;
  listingTitle: string | null;
  price: number | null;
  currency: string | null;
  notes: string;
};

type CatalogueRequestDecision = {
  id: string;
  title: string;
  editionLabel: string;
  sourceUrl: string | null;
  notes: string;
};

type DecisionLane = "sales" | "catalogue" | "plans";
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
  covers,
  outcomes,
  gradingConflicts,
  communityReports,
  catalogueRequests,
  proposals,
}: {
  sales: SaleDecision[];
  printing: PrintDecision[];
  catalogue: CatalogueDecision[];
  covers: CoverDecision[];
  outcomes: ListingOutcomeDecision[];
  gradingConflicts: GradingConflictDecision[];
  communityReports: CommunityDecision[];
  catalogueRequests: CatalogueRequestDecision[];
  proposals: AgentProposal[];
}) {
  const [reviewer, setReviewer] = useStaffReviewer();
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [decisionReasons, setDecisionReasons] = useState<Record<string, string>>({});
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [filter, setFilter] = useState<"all" | DecisionLane>("all");
  const [gradingInputs, setGradingInputs] = useState<Record<string, { company: string; grade: string }>>({});
  const [gradingSourceConfirmed, setGradingSourceConfirmed] = useState<Record<string, boolean>>({});

  const visibleSales = sales.filter((item) => !resolved.has(`sale:${item.observationId}`));
  const visiblePrinting = printing.filter((item) => !resolved.has(`printing:${item.actionId}`));
  const visibleCatalogue = catalogue.filter((item) => !resolved.has(`catalogue:${item.id}`));
  const visibleCovers = covers.filter((item) => !resolved.has(`cover:${item.id}`));
  const visibleOutcomes = outcomes.filter((item) => !resolved.has(`outcome:${item.id}`));
  const visibleGradingConflicts = gradingConflicts.filter((item) => !resolved.has(`grading:${item.observationId}`));
  const visibleCommunityReports = communityReports.filter((item) => !resolved.has(`community:${item.id}`));
  const visibleCatalogueRequests = catalogueRequests.filter((item) => !resolved.has(`request:${item.id}`));
  const visibleProposals = proposals.filter((item) => !resolved.has(`proposal:${item.id}`));
  // Confidence controls prioritisation only. A human still makes every
  // verification decision, including suggestions that eventually score 90%+.
  const highConfidenceProposals = visibleProposals.filter((item) => item.confidence !== null && item.confidence >= 0.9);
  const learningProposals = visibleProposals.filter((item) => item.confidence === null || item.confidence < 0.9);
  const saleReports = visibleCommunityReports.filter((item) => item.reportType === "sale");
  const catalogueReports = visibleCommunityReports.filter((item) => item.reportType !== "sale");

  const counts = {
    all: visibleSales.length + visiblePrinting.length + visibleCatalogue.length + visibleCovers.length + visibleOutcomes.length + visibleGradingConflicts.length + visibleCommunityReports.length + visibleCatalogueRequests.length + highConfidenceProposals.length,
    sales: visibleSales.length + visiblePrinting.length + visibleOutcomes.length + visibleGradingConflicts.length + saleReports.length,
    catalogue: visibleCatalogue.length + visibleCovers.length + visibleCatalogueRequests.length + catalogueReports.length,
    plans: highConfidenceProposals.length,
  };

  function canShow(lane: DecisionLane) {
    return filter === "all" || filter === lane;
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

  async function decideCover(item: CoverDecision, accepted: boolean) {
    const key = `cover:${item.id}`;
    await request(key, "/api/cover-review", {
      candidateId: item.id,
      editionId: item.editionId,
      decision: accepted ? "verified" : "rejected",
      notes: decisionNotes[key] ?? "",
    });
  }

  async function decideOutcome(item: ListingOutcomeDecision, accepted: boolean, confirmation?: OutcomeSaleConfirmation) {
    const key = `outcome:${item.id}`;
    await request(key, "/api/listing-outcomes", {
      ...confirmation,
      outcomeId: item.id,
      decision: accepted ? (item.status === "sold_candidate" ? "confirm_sale" : "keep_watching") : "dismiss",
      notes: decisionNotes[key] ?? "",
    });
  }

  /**
   * Record what a human saw in the slab, or that there was no slab.
   *
   * RAR never reads a grade off a listing title -- a title is a conflict
   * signal, not proof -- so this refuses to send anything until the person
   * says they opened the original listing. The sale's edition match and its
   * verification are untouched: the only thing being settled is whether the
   * copy is raw or graded, which decides the comparison group it belongs in.
   */
  async function correctGrading(item: GradingConflictDecision, copyType: "raw" | "graded") {
    const key = `grading:${item.observationId}`;
    const company = (gradingInputs[item.observationId]?.company ?? "").trim();
    const grade = (gradingInputs[item.observationId]?.grade ?? "").trim();
    // The API refuses a correction that is not confirmed against the original
    // listing, and this card used to satisfy that check by asserting
    // sourceConfirmed on the reviewer's behalf -- so the audit trail recorded
    // that a person had opened the listing when nothing had ever asked them.
    // The confirmation is now the reviewer's own.
    const sourceConfirmed = gradingSourceConfirmed[item.observationId] === true;
    if (!sourceConfirmed) {
      setBanner({ tone: "error", text: "Open the original listing first, then confirm what you saw. RAR never takes a grade from a title." });
      return;
    }
    if (copyType === "graded" && (!company || !grade)) {
      setBanner({ tone: "error", text: "Enter both the grading company and the exact grade shown on the slab." });
      return;
    }
    await request(key, "/api/observation-grading", {
      observationId: item.observationId,
      copyType,
      gradingCompany: copyType === "graded" ? company : null,
      gradeLabel: copyType === "graded" ? grade : null,
      sourceConfirmed,
      notes: decisionNotes[key] ?? "",
    });
  }

  async function decideCommunityReport(item: CommunityDecision, accepted: boolean) {
    const key = `community:${item.id}`;
    await request(key, "/api/community-reports", {
      reportId: item.id,
      decision: accepted ? (item.reportType === "sale" ? "converted" : "reviewed") : "rejected",
      notes: decisionNotes[key] ?? "",
    });
  }

  async function decideCatalogueRequest(item: CatalogueRequestDecision, accepted: boolean) {
    const key = `request:${item.id}`;
    await request(key, "/api/catalogue-requests", {
      requestId: item.id,
      decision: accepted ? "queued_for_research" : "declined",
      notes: decisionNotes[key] ?? "",
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
        {(["all", "sales", "catalogue", "plans"] as const).map((lane) => (
          <button aria-pressed={filter === lane} key={lane} onClick={() => setFilter(lane)} type="button">
            {lane === "all" ? "All work" : lane === "sales" ? "Sales" : lane === "catalogue" ? "Catalogue" : "Agent plans"}
            <span>{counts[lane]}</span>
          </button>
        ))}
      </nav>

      {empty ? <div className="review-empty"><strong>No human input is needed.</strong><p>The agents can continue preparing work in the background.</p></div> : null}

      {canShow("sales") && visibleSales.map((item) => (
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

      {canShow("sales") && visiblePrinting.map((item) => (
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
          {item.approvalBlocker ? <p className="catalogue-approval-conflict" role="status"><strong>Cannot be added from here:</strong> {item.approvalBlocker}</p> : null}
          <DecisionNote reason={decisionReasons[`catalogue:${item.id}`] ?? ""} value={decisionNotes[`catalogue:${item.id}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`catalogue:${item.id}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`catalogue:${item.id}`]: value }))} />
          <div className="human-decision-actions">
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">Check source ↗</a>
            {item.approvalBlocker ? <Link href={`/catalogue-review#candidate-${item.id}`}>Needs detailed review →</Link> : <button disabled={busyKeys.has(`catalogue:${item.id}`)} onClick={() => void decideCatalogue(item, true)} type="button">{busyKeys.has(`catalogue:${item.id}`) ? "Saving…" : "Yes — add edition"}</button>}
            <button className="is-no" disabled={busyKeys.has(`catalogue:${item.id}`)} onClick={() => void decideCatalogue(item, false)} type="button">No — reject</button>
          </div>
        </article>
      ))}

      {canShow("catalogue") && visibleCovers.map((item) => (
        <article className="human-decision-card" key={item.id}>
          <div className="human-decision-question"><span>Cover Curator asks · {item.score}% match</span><h2>Is this the correct cover for this exact edition?</h2></div>
          <div className="human-decision-facts"><img alt={item.candidateTitle ?? item.editionLabel} className="human-decision-cover" src={item.imageUrl} /><p>{item.candidateTitle ?? "Cover candidate"}</p><b>{item.editionLabel}</b><small>{item.sourceName}{item.reasons.length ? ` · ${item.reasons.join(" · ")}` : ""}</small></div>
          <DecisionNote reason={decisionReasons[`cover:${item.id}`] ?? ""} value={decisionNotes[`cover:${item.id}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`cover:${item.id}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`cover:${item.id}`]: value }))} />
          <div className="human-decision-actions"><a href={item.sourceUrl} target="_blank" rel="noreferrer">Check source ↗</a><button disabled={busyKeys.has(`cover:${item.id}`)} onClick={() => void decideCover(item, true)} type="button">{busyKeys.has(`cover:${item.id}`) ? "Saving…" : "Yes — verify cover"}</button><button className="is-no" disabled={busyKeys.has(`cover:${item.id}`)} onClick={() => void decideCover(item, false)} type="button">No — reject</button></div>
        </article>
      ))}

      {canShow("sales") && visibleOutcomes.map((item) => (
        <article className="human-decision-card" key={item.id}>
          <div className="human-decision-question"><span>Outcome Monitor asks{item.score === null ? "" : ` · ${item.score}% match`}</span><h2>{item.status === "sold_candidate" ? "Did this listing sell as the exact edition shown?" : "Should RAR keep watching this unresolved listing?"}</h2></div>
          <div className="human-decision-facts">{item.price !== null && item.currency ? <strong>{formatPrice(item.price, item.currency)}</strong> : null}<span>{item.soldAt ?? item.status.replaceAll("_", " ")}</span><p>{item.listingTitle}</p><b>{item.editionLabel}</b></div>
          <DecisionNote reason={decisionReasons[`outcome:${item.id}`] ?? ""} value={decisionNotes[`outcome:${item.id}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`outcome:${item.id}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`outcome:${item.id}`]: value }))} />
          <div className="human-decision-actions"><a href={item.sourceUrl} target="_blank" rel="noreferrer">Check listing ↗</a>{item.status !== "sold_candidate" ? <button disabled={busyKeys.has(`outcome:${item.id}`)} onClick={() => void decideOutcome(item, true)} type="button">{busyKeys.has(`outcome:${item.id}`) ? "Saving…" : "Yes — keep watching"}</button> : null}{item.status === "sold_candidate" ? null : <Link className="secondary-action" href={`/listing-outcomes?outcome=${item.id}`}>It sold — record the price</Link>}<button className="is-no" disabled={busyKeys.has(`outcome:${item.id}`)} onClick={() => void decideOutcome(item, false)} type="button">No — dismiss</button></div>
          {item.status === "sold_candidate" ? <OutcomeSaleConfirmationForm listingTitle={item.listingTitle} buyingFormat={item.buyingFormat} outcomeProvider={item.outcomeProvider} disabled={!reviewer.trim() || busyKeys.has(`outcome:${item.id}`)} saving={busyKeys.has(`outcome:${item.id}`)} onConfirm={(confirmation) => void decideOutcome(item, true, confirmation)} /> : null}
        </article>
      ))}

      {canShow("sales") && visibleGradingConflicts.map((item) => (
        <article className="human-decision-card" key={item.observationId}>
          <div className="human-decision-question"><span>Grading conflict</span><h2>Is the copy in this sale raw, or is it in a graded slab?</h2></div>
          <div className="human-decision-facts">
            {item.price !== null && item.currency ? <strong>{formatPrice(item.price, item.currency)}</strong> : null}
            <span>{item.soldDate ?? "Date not recorded"}</span>
            <p>{item.listingTitle}</p>
            <b>{item.editionLabel}</b>
          </div>
          <p className="human-decision-reason">
            {item.gradingCompany || item.gradeLabel
              ? "Only half a grade is recorded on this sale, so RAR cannot tell which comparison group it belongs in."
              : "The listing title mentions grading but no grade is recorded, so this sale is currently held out of raw comparisons. A title is not proof of a grade — please open the listing and say what the copy actually is."}
          </p>
          <div className="grading-correction-fields">
            <label>Grading company<input onChange={(event) => setGradingInputs((current) => ({ ...current, [item.observationId]: { ...(current[item.observationId] ?? { grade: "" }), company: event.target.value } }))} placeholder="CGC, CBCS, BGS, PSA…" value={gradingInputs[item.observationId]?.company ?? item.gradingCompany ?? ""} /></label>
            <label>Exact grade<input onChange={(event) => setGradingInputs((current) => ({ ...current, [item.observationId]: { ...(current[item.observationId] ?? { company: "" }), grade: event.target.value } }))} placeholder="9.8" value={gradingInputs[item.observationId]?.grade ?? item.gradeLabel ?? ""} /></label>
          </div>
          <label className="grading-source-confirm">
            <input
              checked={gradingSourceConfirmed[item.observationId] === true}
              onChange={(event) => setGradingSourceConfirmed((current) => ({ ...current, [item.observationId]: event.target.checked }))}
              type="checkbox"
            />
            <span>I opened the original listing and saw what the copy actually is. <small>Required — the grade is never taken from the title.</small></span>
          </label>
          <DecisionNote reason={decisionReasons[`grading:${item.observationId}`] ?? ""} value={decisionNotes[`grading:${item.observationId}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`grading:${item.observationId}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`grading:${item.observationId}`]: value }))} />
          <div className="human-decision-actions">
            <a href={item.sourceUrl} target="_blank" rel="noreferrer">Open original listing ↗</a>
            <button disabled={busyKeys.has(`grading:${item.observationId}`) || gradingSourceConfirmed[item.observationId] !== true} onClick={() => void correctGrading(item, "graded")} type="button">{busyKeys.has(`grading:${item.observationId}`) ? "Saving…" : "It is graded — save this grade"}</button>
            <button className="is-no" disabled={busyKeys.has(`grading:${item.observationId}`) || gradingSourceConfirmed[item.observationId] !== true} onClick={() => void correctGrading(item, "raw")} type="button">It is raw — no slab</button>
          </div>
        </article>
      ))}

      {visibleCommunityReports.filter((item) => canShow(item.reportType === "sale" ? "sales" : "catalogue")).map((item) => (
        <article className="human-decision-card" key={item.id}>
          <div className="human-decision-question"><span>Community report</span><h2>{item.reportType === "sale" ? "Should this reported sale enter RAR's evidence workflow?" : "Should staff accept this reported issue?"}</h2></div>
          <div className="human-decision-facts">{item.price !== null && item.currency ? <strong>{formatPrice(item.price, item.currency)}</strong> : null}<p>{item.listingTitle ?? item.reportType.replaceAll("_", " ")}</p><b>{item.editionLabel}</b><small>{item.notes}</small></div>
          <DecisionNote reason={decisionReasons[`community:${item.id}`] ?? ""} value={decisionNotes[`community:${item.id}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`community:${item.id}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`community:${item.id}`]: value }))} />
          <div className="human-decision-actions"><a href={item.sourceUrl} target="_blank" rel="noreferrer">Check source ↗</a><button disabled={busyKeys.has(`community:${item.id}`)} onClick={() => void decideCommunityReport(item, true)} type="button">{busyKeys.has(`community:${item.id}`) ? "Saving…" : "Yes — accept lead"}</button><button className="is-no" disabled={busyKeys.has(`community:${item.id}`)} onClick={() => void decideCommunityReport(item, false)} type="button">No — reject</button></div>
        </article>
      ))}

      {canShow("catalogue") && visibleCatalogueRequests.map((item) => (
        <article className="human-decision-card" key={item.id}>
          <div className="human-decision-question"><span>Collector request</span><h2>Should the Catalogue Curator research this requested edition?</h2></div>
          <div className="human-decision-facts"><p>{item.title}</p><b>{item.editionLabel}</b><small>{item.notes}</small></div>
          <DecisionNote reason={decisionReasons[`request:${item.id}`] ?? ""} value={decisionNotes[`request:${item.id}`] ?? ""} onReasonChange={(value) => setDecisionReasons((current) => ({ ...current, [`request:${item.id}`]: value }))} onChange={(value) => setDecisionNotes((current) => ({ ...current, [`request:${item.id}`]: value }))} />
          <div className="human-decision-actions">{item.sourceUrl ? <a href={item.sourceUrl} target="_blank" rel="noreferrer">Check source ↗</a> : null}<button disabled={busyKeys.has(`request:${item.id}`)} onClick={() => void decideCatalogueRequest(item, true)} type="button">{busyKeys.has(`request:${item.id}`) ? "Saving…" : "Yes — research"}</button><button className="is-no" disabled={busyKeys.has(`request:${item.id}`)} onClick={() => void decideCatalogueRequest(item, false)} type="button">No — decline</button></div>
        </article>
      ))}

      {canShow("plans") && highConfidenceProposals.map((item) => (
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

      {canShow("plans") && learningProposals.length ? (
        <details className="human-learning-queue">
          <summary>{learningProposals.length} lower-confidence recommendation{learningProposals.length === 1 ? "" : "s"} kept out of the main inbox</summary>
          <p>These remain available for training and investigation, but they do not consume the normal decision queue until they reach 90% confidence.</p>
          <ul>{learningProposals.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{confidenceLabel(item.confidence)}</span>{item.destination ? <Link href={item.destination}>Inspect →</Link> : null}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
