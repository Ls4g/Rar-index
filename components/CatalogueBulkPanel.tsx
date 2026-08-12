"use client";

import { useState } from "react";

export type CatalogueBulkRecord = {
  id: string;
  kind: "edition_candidate" | "series_reference";
  title: string;
  series: string | null;
  volumeNumber: string | null;
  publisher: string | null;
  language: string | null;
  isbn13: string | null;
  releaseDate: string | null;
  sourceName: string | null;
  sourceRecordUrl: string;
};

type BulkDecision = "approve_new" | "rejected" | "duplicate" | "needs_review";

// A series reference identifies a work, not a physical printing, so it can
// never create an edition -- the database refuses it too. Excluding it from
// the approve selection keeps that a design rule rather than a failed row.
function canApprove(record: CatalogueBulkRecord) {
  return record.kind === "edition_candidate" && Boolean(record.title) && Boolean(record.language);
}

export default function CatalogueBulkPanel({ records }: { records: CatalogueBulkRecord[] }) {
  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<BulkDecision | null>(null);
  const [banner, setBanner] = useState<{ tone: "error" | "ok"; text: string } | null>(null);

  const visible = records.filter((record) => !decidedIds.has(record.id));
  if (!visible.length) return null;

  const approvable = visible.filter(canApprove);
  const selectedApprovable = [...selected].filter((id) => approvable.some((record) => record.id === id));

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function decide(decision: BulkDecision) {
    if (!reviewer.trim()) { setBanner({ tone: "error", text: "Add your name or initials first." }); return; }
    const ids = [...selected];
    if (!ids.length) { setBanner({ tone: "error", text: "Tick at least one record first." }); return; }
    if (decision === "approve_new" && ids.length !== selectedApprovable.length) {
      setBanner({ tone: "error", text: "Some selected records are series references or are missing a title or language. They cannot create an edition — deselect them, or handle them individually below." });
      return;
    }
    setSaving(decision);
    setBanner(null);
    try {
      const response = await fetch("/api/catalogue-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogueImportIds: ids, decision, reviewer, notes }),
      });
      const result = (await response.json()) as { saved?: number; failed?: Array<{ id: string; error: string }>; error?: string };
      if (result.error && result.saved === undefined) { setBanner({ tone: "error", text: result.error }); return; }
      const failedIds = new Set((result.failed ?? []).map((failure) => failure.id));
      const succeeded = ids.filter((id) => !failedIds.has(id));
      setDecidedIds((current) => new Set([...current, ...succeeded]));
      setSelected(new Set(failedIds));
      setBanner(failedIds.size
        ? { tone: "error", text: `${succeeded.length} saved. ${failedIds.size} still selected and unsaved — ${(result.failed ?? [])[0]?.error ?? "handle these individually below."}` }
        : { tone: "ok", text: `${succeeded.length} record${succeeded.length === 1 ? "" : "s"} saved.` });
    } catch {
      setBanner({ tone: "error", text: "The decisions could not be saved. Check the connection and try again." });
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="catalogue-bulk-panel">
      <div className="section-intro">
        <p className="eyebrow">Decide a screenful at once</p>
        <h2>{visible.length} candidate{visible.length === 1 ? "" : "s"} in the queue</h2>
        <p className="section-copy">
          Approving here accepts each source record exactly as it stands — title, publisher, language, ISBN and date come from that candidate&apos;s own row. To change any of those, use the full form on the record below instead. Linking to an existing edition is always individual, because it needs one exact edition named.
        </p>
      </div>

      <div className="catalogue-bulk-operator">
        <label>Reviewer<input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials — typed once" value={reviewer} /></label>
        <label>Note (optional)<input onChange={(event) => setNotes(event.target.value)} placeholder="Applied to every record in this batch" value={notes} /></label>
      </div>

      <div className="catalogue-bulk-actions">
        <button disabled={!approvable.length} onClick={() => setSelected(new Set(approvable.map((record) => record.id)))} type="button">Select {approvable.length} approvable</button>
        <button disabled={!selected.size} onClick={() => setSelected(new Set())} type="button">Clear</button>
        <span className="catalogue-bulk-count">{selected.size} selected</span>
        <button className="catalogue-bulk-approve" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("approve_new")} type="button">{saving === "approve_new" ? "Approving…" : "Approve selected"}</button>
        <button className="secondary-action" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("needs_review")} type="button">{saving === "needs_review" ? "Saving…" : "Needs review"}</button>
        <button className="secondary-action" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("duplicate")} type="button">{saving === "duplicate" ? "Saving…" : "Duplicate"}</button>
        <button className="secondary-action" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("rejected")} type="button">{saving === "rejected" ? "Rejecting…" : "Reject"}</button>
      </div>

      {banner ? <p className={`catalogue-bulk-banner ${banner.tone === "error" ? "is-error" : "is-ok"}`} role="status">{banner.text}</p> : null}

      <div className="catalogue-bulk-table" role="table" aria-label="Catalogue candidates">
        {visible.map((record) => {
          const isSelected = selected.has(record.id);
          const isApprovable = canApprove(record);
          return (
            <label className={`catalogue-bulk-row${isSelected ? " is-selected" : ""}${isApprovable ? "" : " is-not-approvable"}`} key={record.id}>
              <input checked={isSelected} onChange={() => toggle(record.id)} type="checkbox" />
              <span className="catalogue-bulk-title">
                <strong>{record.title}</strong>
                <small>{[record.series, record.volumeNumber ? `Vol. ${record.volumeNumber}` : null].filter(Boolean).join(" · ") || "No series recorded"}</small>
              </span>
              <span className="catalogue-bulk-facts">
                <span>{record.publisher ?? "Publisher missing"}</span>
                <span>{record.language ?? "Language missing"}</span>
                <span className="catalogue-bulk-isbn">{record.isbn13 ?? "No ISBN"}</span>
                <span>{record.releaseDate ?? "No date"}</span>
              </span>
              <span className="catalogue-bulk-source">
                {record.kind === "series_reference" ? <em>Series reference — cannot create an edition</em> : null}
                {record.kind === "edition_candidate" && !isApprovable ? <em>Missing a title or language</em> : null}
                <a href={record.sourceRecordUrl} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">{record.sourceName ?? "Source"} ↗</a>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
