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

function CoverQueueRowCard({ edition, reviewer, onReviewerChange }: { edition: CoverQueueRow; reviewer: string; onReviewerChange: (value: string) => void }) {
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
      <CoverDecisionForm edition={edition} reviewer={reviewer} onReviewerChange={onReviewerChange} />
    </article>
  );
}

export default function CoverReviewClient({ rows, focusedRow }: { rows: CoverQueueRow[]; focusedRow: CoverQueueRow | null }) {
  const [reviewer, setReviewer] = useState("");
  const [series, setSeries] = useState("all");
  const [language, setLanguage] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [status, setStatus] = useState("all");
  const [onlyWithSales, setOnlyWithSales] = useState(false);

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
      return true;
    }), [rows, focusedRow, series, language, publisher, status, onlyWithSales]);

  return (
    <>
      {focusedRow ? (
        <section className="review-list-section cover-review-focused-section">
          <div className="section-intro"><p className="eyebrow">Reviewing one edition</p><h2>{focusedRow.title ?? "Untitled edition"}</h2></div>
          <div className="review-list">
            <CoverQueueRowCard edition={focusedRow} reviewer={reviewer} onReviewerChange={setReviewer} />
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
        <p className="coverage-filter-count"><strong>{filteredRows.length}</strong> of {rows.length} editions match these filters.</p>
      </section>

      <section className="review-list-section">
        <div className="section-intro"><p className="eyebrow">Priority queue</p><h2>Editions without a verified cover</h2><p className="section-copy">Sorted by verified-sale count — editions already earning sales are the highest-value cover gaps to close first, since a verified cover is what lets a strong record appear on the homepage shelf.</p></div>
        {filteredRows.length ? (
          <div className="review-list">
            {filteredRows.map((edition) => <CoverQueueRowCard edition={edition} key={edition.editionId} reviewer={reviewer} onReviewerChange={setReviewer} />)}
          </div>
        ) : (
          <div className="review-empty"><strong>No matching editions.</strong><p>Every edition matching these filters already has a verified cover, or the filters are too narrow.</p></div>
        )}
      </section>
    </>
  );
}
