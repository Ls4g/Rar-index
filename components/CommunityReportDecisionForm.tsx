"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Decision = "reviewed" | "rejected" | "converted";

const decisions: Array<{ value: Decision; label: string; hint: string }> = [
  { value: "reviewed", label: "Keep as reviewed", hint: "Useful evidence, but not ready to enter as a sale candidate." },
  { value: "converted", label: "Mark for import", hint: "Preserve this lead for the normal evidence and price-import process." },
  { value: "rejected", label: "Reject report", hint: "Wrong edition, bad source, duplicate, or insufficient evidence." },
];

export default function CommunityReportDecisionForm({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision>("reviewed");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/community-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, decision, reviewer, notes }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The report decision could not be saved.");
      setMessage("Decision recorded. No price data was changed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The report decision could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="community-report-decision" onSubmit={submit}>
      <div className="review-decision-heading"><span>Staff decision</span><small>Every outcome is saved with its evidence note.</small></div>
      <div className="review-options" role="radiogroup" aria-label="Community report decision">
        {decisions.map((option) => <label className={decision === option.value ? "selected" : ""} key={option.value}>
          <input checked={decision === option.value} name={`community-report-${reportId}`} onChange={() => setDecision(option.value)} type="radio" value={option.value} />
          <strong>{option.label}</strong><small>{option.hint}</small>
        </label>)}
      </div>
      <div className="review-form-fields">
        <label>Reviewer<input required onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" value={reviewer} /></label>
        <label>Evidence note<textarea onChange={(event) => setNotes(event.target.value)} placeholder="Optional — what you checked, if it is not obvious from the report." value={notes} /></label>
      </div>
      <div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving…" : "Save decision"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </form>
  );
}
