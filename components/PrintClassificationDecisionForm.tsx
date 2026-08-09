"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Classification = "printing_not_identified" | "known_later_print" | "first_print_proven";

const decisions: Array<{ value: Classification; label: string; hint: string }> = [
  { value: "printing_not_identified", label: "Printing not identified", hint: "The safe default — use unless a specific printing is proven for this exact copy." },
  { value: "known_later_print", label: "Known later printing", hint: "The printing is known, but it is not the first — record the printing number if known." },
  { value: "first_print_proven", label: "First print — proven", hint: "Requires direct proof tied to this exact sold copy, such as a copyright-page image." },
];

type Props = {
  observationId: string;
  currentClassification: Classification;
  currentProofUrl: string | null;
  currentPrintingNumber: number | null;
};

export default function PrintClassificationDecisionForm({ observationId, currentClassification, currentProofUrl, currentPrintingNumber }: Props) {
  const router = useRouter();
  const [classification, setClassification] = useState<Classification>(currentClassification);
  const [proofUrl, setProofUrl] = useState(currentProofUrl ?? "");
  const [printingNumber, setPrintingNumber] = useState(currentPrintingNumber ? String(currentPrintingNumber) : "");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/print-classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ observationId, classification, proofUrl, printingNumber, reviewer, notes }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) { setMessage(result.error ?? "The print classification could not be saved."); return; }
      setMessage("Printing classification recorded. The queue has been refreshed.");
      router.refresh();
    } catch {
      setMessage("The print classification could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="review-decision print-classification-decision" onSubmit={submit}>
      <div className="review-decision-heading"><span>Record printing classification</span><small>Never inferred automatically. A first-print claim always needs a direct proof URL for this exact sale.</small></div>
      <div className="review-options" role="radiogroup" aria-label="Print classification">
        {decisions.map((option) => <label className={classification === option.value ? "selected" : ""} key={option.value}>
          <input checked={classification === option.value} name={`print-classification-${observationId}`} onChange={() => setClassification(option.value)} type="radio" value={option.value} />
          <strong>{option.label}</strong><small>{option.hint}</small>
        </label>)}
      </div>
      <div className="review-form-fields">
        <label>Printing-proof URL <small>{classification === "first_print_proven" ? "Required" : "Optional"}</small><input onChange={(event) => setProofUrl(event.target.value)} placeholder="https://... copyright-page image" type="url" value={proofUrl} /></label>
        <label>Known printing number <small>Optional</small><input inputMode="numeric" min={1} onChange={(event) => setPrintingNumber(event.target.value)} type="number" value={printingNumber} /></label>
        <label>Reviewer<input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" value={reviewer} /></label>
        <label>Evidence note (12+ characters)<textarea onChange={(event) => setNotes(event.target.value)} placeholder="What proves this printing, or why is it unproven?" value={notes} /></label>
      </div>
      <div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving…" : "Save classification"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </form>
  );
}
