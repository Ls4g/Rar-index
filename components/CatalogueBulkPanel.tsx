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
  // Some sources hold no browsable page for the record — the Media Arts
  // Database renders nothing at all for a magazine issue — so its source link
  // opens onto raw data. Sending the reviewer elsewhere to hunt did not fix
  // that: the National Diet Library has an exact record for only 1 of the 13
  // queued issues, and a keyword search returns exhibition books alongside
  // the magazine. So the facts that decide the record are printed here
  // instead, and the links are what they are.
  readableUrl: string | null;
  readableUrlLabel: string | null;
  // Cover price, page count and binding as the source states them: enough to
  // tell a real issue record from a wrong one without leaving the page.
  sourceFacts: string[];
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

  const eligible = visible.filter(canApprove);
  const selectedEligible = [...selected].filter((id) => eligible.some((record) => record.id === id));

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
    if (decision === "approve_new" && ids.length !== selectedEligible.length) {
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
        {/* "Eligible" means the record has the fields needed to create an
            edition, not that its data is right. Calling it "approvable" read
            as an endorsement of records that are frequently nothing of the
            sort -- library-binding resellers, missing dates, publisher names
            that vary by source. The wording has to keep the judgement with
            the reviewer. */}
        <button disabled={!eligible.length} onClick={() => setSelected(new Set(eligible.map((record) => record.id)))} type="button">Select all {eligible.length} eligible</button>
        <button disabled={!selected.size} onClick={() => setSelected(new Set())} type="button">Clear</button>
        <span className="catalogue-bulk-count">{selected.size} selected</span>
        <button className="catalogue-bulk-approve" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("approve_new")} type="button">{saving === "approve_new" ? "Approving…" : "Approve selected"}</button>
        <button className="secondary-action" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("needs_review")} type="button">{saving === "needs_review" ? "Saving…" : "Needs review"}</button>
        <button className="secondary-action" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("duplicate")} type="button">{saving === "duplicate" ? "Saving…" : "Duplicate"}</button>
        <button className="secondary-action" disabled={Boolean(saving) || !selected.size} onClick={() => void decide("rejected")} type="button">{saving === "rejected" ? "Rejecting…" : "Reject"}</button>
      </div>

      <p className="catalogue-bulk-caution">
        Eligible means the record has the fields needed to create an edition — not that its data is right. Bibliographic sources return library-binding resellers, missing dates and publisher names that vary between records for the same book. Read the rows before approving them.
      </p>

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
              {/* Thin fields are marked rather than merely printed, because a
                  missing ISBN or date is the difference between a record that
                  can carry evidence later and one that cannot. */}
              <span className="catalogue-bulk-facts">
                <span className={record.publisher ? "" : "is-thin"}>{record.publisher ?? "Publisher missing"}</span>
                <span className={record.language ? "" : "is-thin"}>{record.language ?? "Language missing"}</span>
                <span className={`catalogue-bulk-isbn${record.isbn13 ? "" : " is-thin"}`}>{record.isbn13 ?? "No ISBN"}</span>
                <span className={record.releaseDate ? "" : "is-thin"}>{record.releaseDate ?? "No date"}</span>
              </span>
              {record.sourceFacts.length ? (
                <span className="catalogue-bulk-sourcefacts">
                  {record.sourceFacts.map((fact) => <span key={fact}>{fact}</span>)}
                </span>
              ) : null}
              <span className="catalogue-bulk-source">
                {record.kind === "series_reference" ? <em>Series reference — cannot create an edition</em> : null}
                {record.kind === "edition_candidate" && !isApprovable ? <em>Missing a title or language</em> : null}
                {record.readableUrl ? <a href={record.readableUrl} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">{record.readableUrlLabel ?? "Library record"} ↗</a> : null}
                <a className={record.readableUrl ? "is-raw" : undefined} href={record.sourceRecordUrl} onClick={(event) => event.stopPropagation()} rel="noreferrer" target="_blank">{record.readableUrl ? "Source data" : (record.sourceName ?? "Source")} ↗</a>
              </span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
