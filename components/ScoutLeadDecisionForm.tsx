"use client";

import { useState } from "react";

export default function ScoutLeadDecisionForm({ leadId }: { leadId: string }) {
  const [decision, setDecision] = useState<"watching" | "dismissed">("watching");
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/scout-leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId, decision, reviewer, notes }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Scout decision could not be saved.");
      setMessage("Decision saved. Refresh to update this queue.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scout decision could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return <form className="review-decision" onSubmit={submit}>
    <div className="review-decision-heading"><span>Scout lead decision</span><small>Active listings remain research leads, never sales.</small></div>
    <div className="review-options" role="radiogroup" aria-label="Scout lead decision">
      <label className={decision === "watching" ? "selected" : undefined}><input checked={decision === "watching"} onChange={() => setDecision("watching")} type="radio" name={`scout-${leadId}`} /> Watch listing</label>
      <label className={decision === "dismissed" ? "selected" : undefined}><input checked={decision === "dismissed"} onChange={() => setDecision("dismissed")} type="radio" name={`scout-${leadId}`} /> Dismiss lead</label>
    </div>
    <div className="review-form-fields">
      <label>Reviewer<input required value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" /></label>
      <label>Evidence note<textarea required minLength={12} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: cover and ISBN fit the target; watch for a completed sale." /></label>
    </div>
    <div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving..." : "Save lead decision"}</button>{message ? <p role="status">{message}</p> : null}</div>
  </form>;
}
