"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

type ReviewDecision = "verified_match" | "needs_review" | "excluded";

const decisions: Array<{ value: ReviewDecision; label: string; hint: string }> = [
  { value: "verified_match", label: "Verify exact match", hint: "Use only when the edition evidence is exact." },
  { value: "needs_review", label: "Keep in review", hint: "Use when the sale is real but edition evidence is incomplete." },
  { value: "excluded", label: "Exclude sale", hint: "Use for wrong editions, withdrawn listings or non-sales." },
];

export default function ReviewDecisionForm({ observationId }: { observationId: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState<ReviewDecision>("needs_review");
  const [reviewer, setReviewer] = useStaffReviewer();
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  // A rejected save and a successful one previously rendered as identical
  // muted text, so a validation failure read as "nothing happened".
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submitReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ observationId, decision, reviewer, notes }) });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) { setFailed(true); setMessage(result.error ?? "The decision could not be saved."); return; }
      setMessage("Decision recorded. The queue has been refreshed.");
      router.refresh();
    } catch {
      setFailed(true);
      setMessage("The decision could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="review-decision" onSubmit={submitReview}>
      <div className="review-decision-heading"><span>Record review decision</span><small>Add an evidence note when it isn&apos;t obvious from the listing.</small></div>
      <div className="review-options" role="radiogroup" aria-label="Review decision">
        {decisions.map((option) => <label className={decision === option.value ? "selected" : ""} key={option.value}>
          <input checked={decision === option.value} name={`decision-${observationId}`} onChange={() => setDecision(option.value)} type="radio" value={option.value} />
          <strong>{option.label}</strong><small>{option.hint}</small>
        </label>)}
      </div>
      <div className="review-form-fields">
        <label>Reviewer<input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" value={reviewer} /></label>
        <label>Evidence note (optional)<textarea onChange={(event) => setNotes(event.target.value)} placeholder="What proves the edition match, or why is it excluded?" value={notes} /></label>
      </div>
      <div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving…" : "Save decision"}</button>{message ? <p className={failed ? "is-error" : "is-ok"} role="status">{message}</p> : null}</div>
    </form>
  );
}
