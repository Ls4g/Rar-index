"use client";

import { useState } from "react";

const options = [
  ["queued_for_research", "Queue for research", "Keep this as a lead for the normal catalogue workflow."],
  ["added_to_catalogue", "Mark catalogue added", "Use only after a verified RAR record exists."],
  ["declined", "Decline request", "Insufficient or incorrect evidence."],
] as const;

export default function CatalogueRequestDecisionForm({ requestId }: { requestId: string }) {
  const [decision, setDecision] = useState<typeof options[number][0]>("queued_for_research");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/catalogue-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, decision, reviewer, notes }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The decision could not be saved.");
      setMessage("Saved. Refresh the queue to see the decision.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The decision could not be saved."); } finally { setSaving(false); }
  }
  return <form className="review-decision catalogue-request-decision" onSubmit={submit}><div className="catalogue-options" role="radiogroup" aria-label="Catalogue request decision">{options.map(([value, label, hint]) => <label className={decision === value ? "selected" : ""} key={value}><input checked={decision === value} name={`catalogue-request-${requestId}`} onChange={() => setDecision(value)} type="radio" value={value} /><strong>{label}</strong><small>{hint}</small></label>)}</div><label>Reviewer<input required value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Your staff name" /></label><label className="catalogue-notes-wide">Decision note<textarea required minLength={12} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What does the evidence prove, or why should this request not proceed?" /></label><div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving..." : "Save request decision"}</button>{message ? <p role="status">{message}</p> : null}</div></form>;
}
