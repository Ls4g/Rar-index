"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

type CatalogueDecision = "approve_new" | "link_existing" | "needs_review" | "rejected" | "duplicate";
type CandidateMetadata = {
  title: string;
  series: string | null;
  volumeNumber: string | null;
  author: string | null;
  publisher: string | null;
  language: string | null;
  isbn13: string | null;
  releaseDate: string | null;
  collectibleType: string | null;
  magazineTitleId: string | null;
  issueYear: string | null;
  issueNumberLabel: string | null;
  cumulativeIssueNo: string | null;
  madbId: string | null;
};

const decisions: Array<{ value: CatalogueDecision; label: string; hint: string }> = [
  { value: "approve_new", label: "Create verified edition", hint: "Only where the source proves a physical edition." },
  { value: "link_existing", label: "Link existing edition", hint: "Attach the source to the exact RAR edition ID." },
  { value: "needs_review", label: "Keep in review", hint: "Evidence is useful but incomplete." },
  { value: "duplicate", label: "Mark duplicate", hint: "Already represented by another queued source." },
  { value: "rejected", label: "Reject candidate", hint: "Wrong work or insufficient catalogue evidence." },
];

type EditionSuggestion = { id: string; title: string | null; language: string | null; isbn_13: string | null; printing_number: number | null; is_verified?: boolean };

export default function CatalogueDecisionForm({ catalogueImportId, isEditionCandidate, candidateTitle, candidate, approvalProblem }: { catalogueImportId: string; isEditionCandidate: boolean; candidateTitle: string; candidate: CandidateMetadata; approvalProblem: string | null }) {
  const router = useRouter();
  const [decision, setDecision] = useState<CatalogueDecision>("needs_review");
  const [reviewer, setReviewer] = useStaffReviewer();
  const [notes, setNotes] = useState("");
  const [existingEditionId, setExistingEditionId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<EditionSuggestion[]>([]);
  const [metadata, setMetadata] = useState<CandidateMetadata>(candidate);
  const [isbnMatches, setIsbnMatches] = useState<EditionSuggestion[]>([]);
  const [printingOfEditionId, setPrintingOfEditionId] = useState("");
  const isMagazine = candidate.collectibleType === "zasshi";

  useEffect(() => {
    if (decision !== "link_existing" || candidateTitle.trim().length < 2) return;
    const controller = new AbortController();
    fetch(`/api/price-import?q=${encodeURIComponent(candidateTitle.trim())}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((result: { editions?: EditionSuggestion[] }) => setSuggestions(result.editions ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [decision, candidateTitle]);

  useEffect(() => {
    if (decision !== "approve_new") return;
    const isbn = (metadata.isbn13 ?? "").trim();
    if (!/^97[89][0-9]{10}$/.test(isbn)) return;
    const controller = new AbortController();
    fetch(`/api/price-import?isbn=${encodeURIComponent(isbn)}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((result: { editions?: EditionSuggestion[] }) => setIsbnMatches(result.editions ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [decision, metadata.isbn13]);

  const allowedDecisions = isEditionCandidate && !approvalProblem ? decisions : decisions.filter((item) => item.value !== "approve_new");
  const currentIsbnMatches = isbnMatches.filter((edition) => edition.isbn_13 === metadata.isbn13);

  async function saveDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/catalogue-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogueImportId,
          decision,
          reviewer,
          notes,
          existingEditionId,
          metadata: decision === "approve_new" && printingOfEditionId ? { ...metadata, printingOfEditionId } : metadata,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(result.error ?? "The catalogue decision could not be saved.");
        return;
      }
      setMessage("Decision recorded. The queue has been refreshed.");
      router.refresh();
    } catch {
      setMessage("The catalogue decision could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="review-decision catalogue-decision" onSubmit={saveDecision}>
      <div className="review-decision-heading"><span>Catalogue decision</span><small>Approval records a durable evidence note.</small></div>
      {approvalProblem ? <p className="catalogue-approval-conflict" role="alert"><strong>Publishing blocked:</strong> {approvalProblem}</p> : null}
      <div className="catalogue-options" role="radiogroup" aria-label="Catalogue decision">
        {allowedDecisions.map((option) => <label className={decision === option.value ? "selected" : ""} key={option.value}>
          <input checked={decision === option.value} name={`catalogue-decision-${catalogueImportId}`} onChange={() => { setDecision(option.value); setPrintingOfEditionId(""); }} type="radio" value={option.value} />
          <strong>{option.label}</strong><small>{option.hint}</small>
        </label>)}
      </div>
      <div className="review-form-fields">
        <label>Reviewer<input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" required value={reviewer} /></label>
        {decision === "link_existing" ? <label>Existing RAR edition ID<input onChange={(event) => setExistingEditionId(event.target.value)} placeholder="UUID from the exact edition page" required value={existingEditionId} /></label> : null}
        <label className={decision === "link_existing" ? "catalogue-notes" : "catalogue-notes-wide"}>Evidence note<textarea onChange={(event) => setNotes(event.target.value)} placeholder="Optional — add anything a future reader would need that the source record does not already show." value={notes} /></label>
      </div>
      {decision === "approve_new" ? <fieldset className="catalogue-metadata">
        <legend>Verified edition details</legend>
        <p>{isMagazine
          ? "Clean the descriptive fields before publishing. The magazine, year and printed issue identifiers below come from the queued source record and are preserved automatically."
          : "Clean these before publishing. RAR records the standard volume here; a specific printing is added separately later."}</p>
        <div className="review-form-fields">
          <label>Title<input onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} required value={metadata.title} /></label>
          <label>Series<input onChange={(event) => setMetadata({ ...metadata, series: event.target.value || null })} value={metadata.series ?? ""} /></label>
          <label>Volume number<input inputMode="numeric" onChange={(event) => setMetadata({ ...metadata, volumeNumber: event.target.value || null })} placeholder="1" value={metadata.volumeNumber ?? ""} /></label>
          <label>Language<input onChange={(event) => setMetadata({ ...metadata, language: event.target.value || null })} required value={metadata.language ?? ""} /></label>
          <label>Author<input onChange={(event) => setMetadata({ ...metadata, author: event.target.value || null })} value={metadata.author ?? ""} /></label>
          <label>Publisher<input onChange={(event) => setMetadata({ ...metadata, publisher: event.target.value || null })} value={metadata.publisher ?? ""} /></label>
          <label>ISBN-13<input inputMode="numeric" onChange={(event) => { setMetadata({ ...metadata, isbn13: event.target.value || null }); setPrintingOfEditionId(""); }} value={metadata.isbn13 ?? ""} /></label>
          <label>Release date<input onChange={(event) => setMetadata({ ...metadata, releaseDate: event.target.value || null })} type="date" value={metadata.releaseDate ?? ""} /></label>
        </div>
        {isMagazine ? <dl className="catalogue-details">
          <div><dt>Collectible type</dt><dd>Magazine issue (zasshi)</dd></div>
          <div><dt>Issue</dt><dd>{[candidate.issueYear, candidate.issueNumberLabel ? `No. ${candidate.issueNumberLabel}` : null].filter(Boolean).join(" · ")}</dd></div>
          {candidate.cumulativeIssueNo ? <div><dt>Cumulative issue</dt><dd>{candidate.cumulativeIssueNo}</dd></div> : null}
          {candidate.madbId ? <div><dt>Media Arts ID</dt><dd>{candidate.madbId}</dd></div> : null}
        </dl> : null}
      </fieldset> : null}
      {decision === "approve_new" && currentIsbnMatches.length ? <div className="catalogue-isbn-warning" role="alert">
        <p>ISBN {metadata.isbn13} already exists in the catalogue. This will be blocked unless you either use &quot;Link existing edition&quot; instead, or confirm this candidate is a specific printing of one of the records below.</p>
        <div className="edition-suggestions">{currentIsbnMatches.map((edition) => <button className={printingOfEditionId === edition.id ? "selected" : ""} type="button" key={edition.id} onClick={() => setPrintingOfEditionId(printingOfEditionId === edition.id ? "" : edition.id)}>{[edition.title, edition.language, edition.is_verified ? null : "unverified", edition.printing_number ? `Printing ${edition.printing_number}` : "General edition record"].filter(Boolean).join(" | ")}</button>)}</div>
        {printingOfEditionId ? <p>This candidate will be saved as a specific printing of the selected record.</p> : null}
      </div> : null}
      {decision === "link_existing" && suggestions.length ? <div className="edition-suggestions">{suggestions.map((edition) => <button type="button" key={edition.id} onClick={() => setExistingEditionId(edition.id)}>{[edition.title, edition.language, edition.printing_number ? `Printing ${edition.printing_number}` : null, edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null].filter(Boolean).join(" | ")}</button>)}</div> : null}
      <div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving…" : "Save catalogue decision"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </form>
  );
}
