"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { editionDescriptor, publisherDisplayName } from "@/lib/editionDisplay";

export type CoverQueueRow = {
  editionId: string;
  title: string | null;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
  editionStatement: string | null;
  printingNumber: number | null;
  variantName: string | null;
  collectibleType: string | null;
  coverImageUrl: string | null;
  coverSourceUrl: string | null;
  coverSourceName: string | null;
  coverStatus: "missing" | "candidate" | "verified" | "rejected";
  coverVerifiedAt: string | null;
  printingOfEditionId: string | null;
  verifiedSaleCount: number;
};

export type CoverCandidateRow = {
  id: string;
  editionId: string;
  sourceName: string;
  coverImageUrl: string;
  sourceRecordUrl: string;
  candidateTitle: string | null;
  candidatePublisher: string | null;
  candidateLanguage: string | null;
  candidateIsbn13: string | null;
  matchScore: number;
  matchConfidence: "strong" | "partial";
  matchReasons: string[];
  discoveredAt: string;
};

type Decision = "candidate" | "verified" | "rejected";

const coverLabels: Record<CoverQueueRow["coverStatus"], string> = {
  missing: "Cover pending",
  candidate: "Cover under review",
  rejected: "Cover not confirmed",
  verified: "Verified cover",
};

function coverToneClass(status: CoverQueueRow["coverStatus"]) {
  if (status === "verified") return "coverage-good";
  if (status === "candidate") return "coverage-neutral";
  return "coverage-warning";
}

const decisionOptions: Array<{ value: Decision; label: string; hint: string }> = [
  { value: "candidate", label: "Save as candidate", hint: "Stage a found cover for later confirmation. Never shown publicly." },
  { value: "verified", label: "Verify cover", hint: "Requires an image URL, a source record URL, and a source name — never a marketplace listing photo." },
  { value: "rejected", label: "Reject cover", hint: "This candidate did not match this exact edition." },
];

function canSubmit(decision: Decision, imageUrl: string, sourceUrl: string, sourceName: string, reviewer: string, notes: string) {
  if (!reviewer.trim() || notes.trim().length < 12) return false;
  if (decision === "verified") return Boolean(imageUrl.trim() && sourceUrl.trim() && sourceName.trim());
  if (decision === "candidate") return Boolean(imageUrl.trim() || sourceUrl.trim());
  return true;
}

function CoverDecisionForm({ edition, reviewer, onReviewerChange }: { edition: CoverQueueRow; reviewer: string; onReviewerChange: (value: string) => void }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision>(edition.coverStatus === "rejected" ? "candidate" : "verified");
  const [imageUrl, setImageUrl] = useState(edition.coverImageUrl ?? "");
  const [sourceUrl, setSourceUrl] = useState(edition.coverSourceUrl ?? "");
  const [sourceName, setSourceName] = useState(edition.coverSourceName ?? "");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);

  const ready = canSubmit(decision, imageUrl, sourceUrl, sourceName, reviewer, notes);

  async function submitDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/cover-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editionId: edition.editionId,
          decision,
          coverImageUrl: imageUrl,
          coverSourceUrl: sourceUrl,
          coverSourceName: sourceName,
          reviewer,
          notes,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) { setMessage(result.error ?? "The cover decision could not be saved."); return; }
      setMessage("Decision recorded. The queue has been refreshed.");
      setNotes("");
      router.refresh();
    } catch {
      setMessage("The cover decision could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="review-decision" onSubmit={submitDecision}>
      <div className="review-decision-heading"><span>Record cover decision</span><small>Marketplace listing photos must never become a catalogue cover — link the publisher or licensed catalogue record instead.</small></div>

      <div className="review-options" role="radiogroup" aria-label={`Cover decision for ${edition.title ?? "this edition"}`}>
        {decisionOptions.map((option) => (
          <label className={decision === option.value ? "selected" : ""} key={option.value}>
            <input checked={decision === option.value} name={`cover-decision-${edition.editionId}`} onChange={() => setDecision(option.value)} type="radio" value={option.value} />
            <strong>{option.label}</strong>
            <small>{option.hint}</small>
          </label>
        ))}
      </div>

      <div className="review-form-fields cover-review-fields">
        <label>Cover image URL<input onChange={(event) => { setImageUrl(event.target.value); setPreviewFailed(false); }} placeholder="https://...jpg" type="url" value={imageUrl} /></label>
        <label>Source record URL<input onChange={(event) => setSourceUrl(event.target.value)} placeholder="Publisher or licensed catalogue page" type="url" value={sourceUrl} /></label>
        <label>Source name<input onChange={(event) => setSourceName(event.target.value)} placeholder="e.g. VIZ official product record" value={sourceName} /></label>
        <label>Reviewer<input onChange={(event) => onReviewerChange(event.target.value)} placeholder="Your name or initials" value={reviewer} /></label>
        <label className="cover-review-note">Review note<textarea onChange={(event) => setNotes(event.target.value)} placeholder="What proves this cover, or why is it rejected?" value={notes} /></label>
      </div>

      {imageUrl.trim() ? (
        <div className="cover-review-preview">
          {previewFailed ? (
            <p className="cover-review-preview-error">This image URL did not load. Check it before verifying.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="Cover preview" onError={() => setPreviewFailed(true)} onLoad={() => setPreviewFailed(false)} src={imageUrl.trim()} />
          )}
        </div>
      ) : null}

      <div className="review-submit-row">
        <button disabled={saving || !ready} type="submit">{saving ? "Saving…" : "Save decision"}</button>
        {!ready && !saving ? <p className="cover-review-hint">Reviewer, a note of 12+ characters, and the URLs required by the selected decision are all needed before this can save.</p> : null}
        {message ? <p role="status">{message}</p> : null}
      </div>
    </form>
  );
}

function CoverCandidateCard({ candidate, edition, reviewer }: { candidate: CoverCandidateRow; edition: CoverQueueRow; reviewer: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState<"verified" | "rejected" | null>(null);
  const [message, setMessage] = useState("");

  async function decide(decision: "verified" | "rejected") {
    if (!reviewer.trim()) {
      setMessage("Enter your reviewer name or initials above first.");
      return;
    }
    setSaving(decision);
    setMessage("");
    const notes = decision === "verified"
      ? "Exact ISBN and source record reviewed by staff."
      : "Candidate rejected after exact-edition review.";
    try {
      const response = await fetch("/api/cover-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateId: candidate.id, editionId: edition.editionId, decision, reviewer, notes }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(result.error ?? "The candidate decision could not be saved.");
        return;
      }
      setMessage(decision === "verified" ? "Cover verified and published." : "Candidate removed from the queue.");
      router.refresh();
    } catch {
      setMessage("The candidate decision could not be saved. Check the connection and try again.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <article className="cover-candidate-card">
      <div className="cover-candidate-image">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={`Candidate cover for ${edition.title ?? "this edition"}`} src={candidate.coverImageUrl} />
      </div>
      <div className="cover-candidate-copy">
        <div className="cover-candidate-topline">
          <span>{candidate.sourceName}</span>
          <strong>{candidate.matchScore}/100 · {candidate.matchConfidence}</strong>
        </div>
        <h4>{candidate.candidateTitle ?? edition.title ?? "Untitled candidate"}</h4>
        <p>{[candidate.candidatePublisher, candidate.candidateLanguage, candidate.candidateIsbn13].filter(Boolean).join(" · ")}</p>
        <ul>{candidate.matchReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <Link href={candidate.sourceRecordUrl} target="_blank" rel="noreferrer">Inspect source record ↗</Link>
        <div className="cover-candidate-actions">
          <button disabled={Boolean(saving)} onClick={() => decide("verified")} type="button">{saving === "verified" ? "Verifying…" : "Verify cover"}</button>
          <button className="secondary-action" disabled={Boolean(saving)} onClick={() => decide("rejected")} type="button">{saving === "rejected" ? "Rejecting…" : "Reject candidate"}</button>
        </div>
        {message ? <p className="cover-candidate-message" role="status">{message}</p> : null}
      </div>
    </article>
  );
}

function CoverQueueRowCard({ edition, candidates, reviewer, onReviewerChange }: { edition: CoverQueueRow; candidates: CoverCandidateRow[]; reviewer: string; onReviewerChange: (value: string) => void }) {
  return (
    <article className="review-card" id={`edition-${edition.editionId}`}>
      <div className="review-card-topline">
        <span>{[edition.series, edition.volumeNumber ? `Vol. ${edition.volumeNumber}` : null, edition.language].filter(Boolean).join(" · ") || "Uncategorised"}</span>
        <span className={`coverage-badge ${coverToneClass(edition.coverStatus)}`}>{coverLabels[edition.coverStatus]}</span>
      </div>
      <div className="review-card-main">
        <div>
          <h3>{edition.title ?? "Untitled edition"}</h3>
          <p className="review-condition">
            {publisherDisplayName(edition.publisher)} · {edition.isbn13 ?? "ISBN pending"} · {editionDescriptor({ edition_statement: edition.editionStatement, printing_number: edition.printingNumber, variant_name: edition.variantName })}
            {edition.printingOfEditionId ? " · printing of another record" : ""}
          </p>
          <p className="review-condition cover-review-sale-count">{edition.verifiedSaleCount} verified sale{edition.verifiedSaleCount === 1 ? "" : "s"}</p>
        </div>
        <Link className="review-source-link" href={`/edition/${edition.editionId}`} target="_blank" rel="noreferrer">Open edition ↗</Link>
      </div>
      {candidates.length ? (
        <section className="cover-candidate-results">
          <div className="review-decision-heading"><span>{candidates.length} candidate{candidates.length === 1 ? "" : "s"} found</span><small>Inspect the exact source record, then verify or reject. Nothing appears publicly before verification.</small></div>
          <div className="cover-candidate-grid">
            {candidates.map((candidate) => <CoverCandidateCard candidate={candidate} edition={edition} key={candidate.id} reviewer={reviewer} />)}
          </div>
        </section>
      ) : <p className="cover-candidate-empty">No automated candidate found yet. Run the finder above or use manual entry.</p>}
      <details className="cover-manual-review">
        <summary>Manual cover entry or correction</summary>
        <CoverDecisionForm edition={edition} reviewer={reviewer} onReviewerChange={onReviewerChange} />
      </details>
    </article>
  );
}

function CandidateFinder() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");

  async function findCandidates() {
    setRunning(true);
    setMessage("");
    try {
      const response = await fetch("/api/cover-review/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 20 }),
      });
      const result = (await response.json()) as { error?: string; editionsScanned?: number; candidatesFound?: number; candidatesQueued?: number; sourceWarnings?: string[] };
      if (!response.ok) {
        setMessage(result.error ?? "The candidate search could not run.");
        return;
      }
      setMessage(`Checked ${result.editionsScanned ?? 0} editions. Found ${result.candidatesFound ?? 0} matching covers; ${result.candidatesQueued ?? 0} were new.`);
      router.refresh();
    } catch {
      setMessage("The candidate search could not run. Check the connection and try again.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="cover-candidate-finder">
      <div><p className="eyebrow">Automated research, human approval</p><h2>Find the next cover batch</h2><p>Checks Google Books and Open Library by exact ISBN for the 20 highest-priority gaps. Results stay staff-only until you verify them.</p></div>
      <div><button disabled={running} onClick={findCandidates} type="button">{running ? "Checking sources…" : "Find covers for next 20"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </section>
  );
}

export default function CoverReviewClient({ rows, focusedRow, candidates }: { rows: CoverQueueRow[]; focusedRow: CoverQueueRow | null; candidates: CoverCandidateRow[] }) {
  const [reviewer, setReviewer] = useState("");
  const [series, setSeries] = useState("all");
  const [language, setLanguage] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [status, setStatus] = useState("all");
  const [onlyWithSales, setOnlyWithSales] = useState(false);
  const [onlyWithCandidates, setOnlyWithCandidates] = useState(false);

  const candidatesByEdition = useMemo(() => {
    const grouped = new Map<string, CoverCandidateRow[]>();
    for (const candidate of candidates) grouped.set(candidate.editionId, [...(grouped.get(candidate.editionId) ?? []), candidate]);
    return grouped;
  }, [candidates]);

  const seriesOptions = useMemo(() => [...new Set(rows.map((row) => row.series).filter((value): value is string => Boolean(value)))].sort(), [rows]);
  const languageOptions = useMemo(() => [...new Set(rows.map((row) => row.language).filter((value): value is string => Boolean(value)))].sort(), [rows]);
  const publisherOptions = useMemo(() => [...new Set(rows.map((row) => publisherDisplayName(row.publisher)))].sort(), [rows]);

  const filteredRows = useMemo(() => rows
    .filter((row) => row.editionId !== focusedRow?.editionId)
    .filter((row) => {
      if (series !== "all" && row.series !== series) return false;
      if (language !== "all" && row.language !== language) return false;
      if (publisher !== "all" && publisherDisplayName(row.publisher) !== publisher) return false;
      if (status !== "all" && row.coverStatus !== status) return false;
      if (onlyWithSales && row.verifiedSaleCount === 0) return false;
      if (onlyWithCandidates && !(candidatesByEdition.get(row.editionId)?.length)) return false;
      return true;
    }), [rows, focusedRow, series, language, publisher, status, onlyWithSales, onlyWithCandidates, candidatesByEdition]);

  return (
    <>
      <CandidateFinder />
      <section className="cover-review-operator">
        <label>Reviewer name or initials<input onChange={(event) => setReviewer(event.target.value)} placeholder="Type once for this session" value={reviewer} /></label>
        <p>This name is used for the candidate decisions below. Every verification or rejection remains auditable.</p>
      </section>
      {focusedRow ? (
        <section className="review-list-section cover-review-focused-section">
          <div className="section-intro"><p className="eyebrow">Reviewing one edition</p><h2>{focusedRow.title ?? "Untitled edition"}</h2></div>
          <div className="review-list">
            <CoverQueueRowCard candidates={candidatesByEdition.get(focusedRow.editionId) ?? []} edition={focusedRow} reviewer={reviewer} onReviewerChange={setReviewer} />
          </div>
        </section>
      ) : null}

      <section className="review-list-section coverage-filters-section">
        <div className="section-intro"><p className="eyebrow">Narrow the queue</p><h2>Filters</h2></div>
        <div className="browse-controls coverage-filters" aria-label="Filter the cover review queue">
          <label>Series<select value={series} onChange={(event) => setSeries(event.target.value)}><option value="all">All series</option>{seriesOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{languageOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Publisher<select value={publisher} onChange={(event) => setPublisher(event.target.value)}><option value="all">All publishers</option>{publisherOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label>Cover status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Any</option><option value="missing">Missing</option><option value="candidate">Under review</option><option value="rejected">Not confirmed</option></select></label>
        </div>
        <label className="cover-review-sales-filter"><input checked={onlyWithSales} onChange={(event) => setOnlyWithSales(event.target.checked)} type="checkbox" /> Has verified sales</label>
        <label className="cover-review-sales-filter"><input checked={onlyWithCandidates} onChange={(event) => setOnlyWithCandidates(event.target.checked)} type="checkbox" /> Has discovered candidates</label>
        <p className="coverage-filter-count"><strong>{filteredRows.length}</strong> of {rows.length} editions match these filters.</p>
      </section>

      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Priority queue</p><h2>Editions without a verified cover</h2><p className="section-copy">Sorted by verified-sale count — editions already earning sales are the highest-value cover gaps to close first, since a verified cover is what lets a strong record appear on the homepage shelf.</p></div>
        {filteredRows.length ? (
          <div className="review-list">
            {filteredRows.map((edition) => <CoverQueueRowCard candidates={candidatesByEdition.get(edition.editionId) ?? []} edition={edition} key={edition.editionId} reviewer={reviewer} onReviewerChange={setReviewer} />)}
          </div>
        ) : (
          <div className="review-empty"><strong>No matching editions.</strong><p>Every edition matching these filters already has a verified cover, or the filters are too narrow.</p></div>
        )}
      </section>
    </>
  );
}
