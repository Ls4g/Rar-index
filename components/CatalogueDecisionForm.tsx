"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
};

const decisions: Array<{ value: CatalogueDecision; label: string; hint: string }> = [
  { value: "approve_new", label: "Create verified edition", hint: "Only where the source proves a physical edition." },
  { value: "link_existing", label: "Link existing edition", hint: "Attach the source to the exact RAR edition ID." },
  { value: "needs_review", label: "Keep in review", hint: "Evidence is useful but incomplete." },
  { value: "duplicate", label: "Mark duplicate", hint: "Already represented by another queued source." },
  { value: "rejected", label: "Reject candidate", hint: "Wrong work or insufficient catalogue evidence." },
];

type EditionSuggestion = { id: string; title: string | null; language: string | null; isbn_13: string | null; printing_number: number | null };

export default function CatalogueDecisionForm({ catalogueImportId, isEditionCandidate, candidateTitle, candidate }: { catalogueImportId: string; isEditionCandidate: boolean; candidateTitle: string; candidate: CandidateMetadata }) {
  const router = useRouter();
  const [decision, setDecision] = useState<CatalogueDecision>("needs_review");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [existingEditionId, setExistingEditionId] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<EditionSuggestion[]>([]);
  const [metadata, setMetadata] = useState<CandidateMetadata>(candidate);

  useEffect(() => {
    if (decision !== "link_existing" || candidateTitle.trim().length < 2) return setSuggestions([]);
    const controller = new AbortController();
    fetch(`/api/price-import?q=${encodeURIComponent(candidateTitle.trim())}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((result: { editions?: EditionSuggestion[] }) => setSuggestions(result.editions ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [decision, candidateTitle]);

  const allowedDecisions = isEditionCandidate ? decisions : decisions.filter((item) => item.value !== "approve_new");

  async function saveDecision(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/catalogue-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogueImportId, decision, reviewer, notes, existingEditionId, metadata }),
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
      <div className="catalogue-options" role="radiogroup" aria-label="Catalogue decision">
        {allowedDecisions.map((option) => <label className={decision === option.value ? "selected" : ""} key={option.value}>
          <input checked={decision === option.value} name={`catalogue-decision-${catalogueImportId}`} onChange={() => setDecision(option.value)} type="radio" value={option.value} />
          <strong>{option.label}</strong><small>{option.hint}</small>
        </label>)}
      </div>
      <div className="review-form-fields">
        <label>Reviewer<input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" required value={reviewer} /></label>
        {decision === "link_existing" ? <label>Existing RAR edition ID<input onChange={(event) => setExistingEditionId(event.target.value)} placeholder="UUID from the exact edition page" required value={existingEditionId} /></label> : null}
        <label className={decision === "link_existing" ? "catalogue-notes" : "catalogue-notes-wide"}>Evidence note<textarea minLength={12} onChange={(event) => setNotes(event.target.value)} placeholder="What does this source prove about the edition, or why is it not acceptable?" required value={notes} /></label>
      </div>
      {decision === "approve_new" ? <fieldset className="catalogue-metadata">
        <legend>Verified edition details</legend>
        <p>Clean these before publishing. RAR records the standard Volume 1 here; a specific printing is added separately later.</p>
        <div className="review-form-fields">
          <label>Title<input onChange={(event) => setMetadata({ ...metadata, title: event.target.value })} required value={metadata.title} /></label>
          <label>Series<input onChange={(event) => setMetadata({ ...metadata, series: event.target.value || null })} value={metadata.series ?? ""} /></label>
          <label>Volume number<input inputMode="numeric" onChange={(event) => setMetadata({ ...metadata, volumeNumber: event.target.value || null })} placeholder="1" value={metadata.volumeNumber ?? ""} /></label>
          <label>Language<input onChange={(event) => setMetadata({ ...metadata, language: event.target.value || null })} required value={metadata.language ?? ""} /></label>
          <label>Author<input onChange={(event) => setMetadata({ ...metadata, author: event.target.value || null })} value={metadata.author ?? ""} /></label>
          <label>Publisher<input onChange={(event) => setMetadata({ ...metadata, publisher: event.target.value || null })} value={metadata.publisher ?? ""} /></label>
          <label>ISBN-13<input inputMode="numeric" onChange={(event) => setMetadata({ ...metadata, isbn13: event.target.value || null })} value={metadata.isbn13 ?? ""} /></label>
          <label>Release date<input onChange={(event) => setMetadata({ ...metadata, releaseDate: event.target.value || null })} type="date" value={metadata.releaseDate ?? ""} /></label>
        </div>
      </fieldset> : null}
      {decision === "link_existing" && suggestions.length ? <div className="edition-suggestions">{suggestions.map((edition) => <button type="button" key={edition.id} onClick={() => setExistingEditionId(edition.id)}>{[edition.title, edition.language, edition.printing_number ? `Printing ${edition.printing_number}` : null, edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null].filter(Boolean).join(" | ")}</button>)}</div> : null}
      <div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving…" : "Save catalogue decision"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </form>
  );
}
