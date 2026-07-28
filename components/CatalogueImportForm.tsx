"use client";

import { useState } from "react";

type CatalogueSource = "open_library" | "mangadex";
type Candidate = { external_id: string; source_record_url: string; candidate_kind: "edition_candidate" | "series_reference"; candidate_title: string; candidate_author?: string | null; candidate_language?: string | null; candidate_isbn_13?: string | null; candidate_release_date?: string | null };

export default function CatalogueImportForm() {
  const [source, setSource] = useState<CatalogueSource>("open_library");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  async function importCandidates(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/catalogue-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, query, dryRun: true }),
      });
      const result = (await response.json()) as { error?: string; message?: string; candidates?: Candidate[] };
      if (!response.ok) throw new Error(result.error ?? "Candidates could not be found.");
      setCandidates(result.candidates ?? []);
      setSelectedIds([]);
      setMessage(result.message ?? "Choose only the exact source records to queue.");
    } catch {
      setMessage("The catalogue source could not be reached. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function queueSelected() {
    if (!selectedIds.length) return setMessage("Select at least one exact source record first.");
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/catalogue-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, query, selectedExternalIds: selectedIds }) });
      const result = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) throw new Error(result.error ?? "Candidates could not be queued.");
      setCandidates([]); setSelectedIds([]); setMessage(result.message ?? "Candidates queued for review.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Candidates could not be queued."); }
    finally { setSaving(false); }
  }

  return (
    <form className="catalogue-import-form" onSubmit={importCandidates}>
      <label>
        Catalogue source
        <select onChange={(event) => setSource(event.target.value as CatalogueSource)} value={source}>
          <option value="open_library">Open Library — edition candidates</option>
          <option value="mangadex">MangaDex — series references</option>
        </select>
      </label>
      <label>
        Search title
        <input minLength={2} onChange={(event) => { setQuery(event.target.value); setCandidates([]); setSelectedIds([]); }} placeholder="e.g. One Piece" required value={query} />
      </label>
      <div className="catalogue-form-actions">
        <button disabled={saving} type="submit">{saving ? "Importing…" : "Find candidates"}</button>
        {message ? <p role="status">{message}</p> : null}
      </div>
      <p className="catalogue-form-note">Nothing here becomes a verified edition automatically. Each candidate is checked in the catalogue review queue.</p>
      {candidates.length ? <div className="catalogue-options" aria-label="Source candidates">{candidates.map((candidate) => <label className={selectedIds.includes(candidate.external_id) ? "selected" : ""} key={candidate.external_id}><input type="checkbox" checked={selectedIds.includes(candidate.external_id)} onChange={() => setSelectedIds((ids) => ids.includes(candidate.external_id) ? ids.filter((id) => id !== candidate.external_id) : [...ids, candidate.external_id])} /><strong>{candidate.candidate_title}</strong><small>{[candidate.candidate_kind === "series_reference" ? "Series reference" : "Edition candidate", candidate.candidate_language, candidate.candidate_isbn_13, candidate.candidate_release_date].filter(Boolean).join(" · ")}</small><a href={candidate.source_record_url} target="_blank" rel="noreferrer">Open source ↗</a></label>)}</div> : null}
      {candidates.length ? <div className="catalogue-form-actions"><button type="button" disabled={saving} onClick={queueSelected}>Queue {selectedIds.length} selected record{selectedIds.length === 1 ? "" : "s"}</button><p>Select only records you can identify; unselected results never enter RAR.</p></div> : null}
    </form>
  );
}
