"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CollectionRunForm({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [checkedBy, setCheckedBy] = useState("");
  const [candidateCount, setCandidateCount] = useState("0");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function submitRun(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/collection-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, checkedBy, candidateCount: Number(candidateCount), notes }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) { setMessage(result.error ?? "The collection run could not be saved."); return; }
      setMessage("Collection run recorded. You can now use it when importing sales.");
      setNotes("");
      router.refresh();
    } catch {
      setMessage("The collection run could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="review-decision" onSubmit={submitRun}>
      <div className="review-decision-heading"><span>Record collection run</span><small>Record only facts observed in this completed-listings search.</small></div>
      <div className="review-form-fields">
        <label>Checked by<input required value={checkedBy} onChange={(event) => setCheckedBy(event.target.value)} placeholder="Your name or initials" /></label>
        <label>Candidates found<input required min="0" step="1" type="number" value={candidateCount} onChange={(event) => setCandidateCount(event.target.value)} /></label>
        <label>Run note<textarea required minLength={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: 4 completed listings reviewed; 1 may match ISBN and first-print evidence." /></label>
      </div>
      <div className="review-submit-row"><button disabled={saving} type="submit">{saving ? "Saving…" : "Save collection run"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </form>
  );
}
