"use client";

import { useState } from "react";

type CatalogueSource = "open_library" | "mangadex" | "shueisha" | "ndl_search" | "publisher_record";
type PublisherRecordSource = "kodansha_japan" | "kodansha_usa" | "viz_media" | "tokyopop_archive";
type Candidate = { external_id: string; source_record_url: string; candidate_kind: "edition_candidate" | "series_reference"; candidate_title: string; candidate_author?: string | null; candidate_language?: string | null; candidate_isbn_13?: string | null; candidate_release_date?: string | null };

export default function CatalogueImportForm() {
  const [source, setSource] = useState<CatalogueSource>("open_library");
  const [query, setQuery] = useState("");
  const [batchIsbns, setBatchIsbns] = useState("");
  const [publisherSource, setPublisherSource] = useState<PublisherRecordSource>("kodansha_japan");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const sourceInstructions: Record<CatalogueSource, { description: string; placeholder: string }> = {
    open_library: { description: "Edition candidates only. Treat every field as a lead to verify.", placeholder: "e.g. One Piece" },
    mangadex: { description: "Work/series reference only. It cannot create a physical edition.", placeholder: "e.g. One Piece" },
    shueisha: { description: "Official Shueisha record. Search by Japanese ISBN only (ISBN-10 or ISBN-13).", placeholder: "e.g. 9784088725093" },
    ndl_search: { description: "National Diet Library cross-check. Search by title or ISBN; records remain candidates.", placeholder: "e.g. ONE PIECE 1 or 9784088725093" },
    publisher_record: { description: "Official publisher record, or the labelled TokyoPop archival catalogue record. The original page is preserved for review.", placeholder: "https://..." },
  };

  async function importCandidates(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const queries = source === "shueisha" ? batchIsbns.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean) : [query.trim()];
    if (!queries.length) return setMessage(source === "shueisha" ? "Paste at least one ISBN first." : "Enter a title or ISBN first.");
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/catalogue-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, publisherSource, query, queries, dryRun: true }),
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
      const queries = source === "shueisha" ? batchIsbns.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean) : [query.trim()];
      const response = await fetch("/api/catalogue-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, publisherSource, query, queries, selectedExternalIds: selectedIds }) });
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
          <option value="shueisha">Shueisha Direct — official Japanese editions</option>
          <option value="ndl_search">National Diet Library — Japanese bibliography</option>
          <option value="publisher_record">Publisher / archive record URL — exact edition</option>
        </select>
      </label>
      {source === "shueisha" ? <label>
        Japanese ISBNs
        <textarea minLength={2} onChange={(event) => { setBatchIsbns(event.target.value); setCandidates([]); setSelectedIds([]); }} placeholder={"One ISBN per line\n9784088725093\n9784088725109"} required value={batchIsbns} />
      </label> : source === "publisher_record" ? <><label>
        Record source
        <select onChange={(event) => { setPublisherSource(event.target.value as PublisherRecordSource); setCandidates([]); setSelectedIds([]); }} value={publisherSource}>
          <option value="kodansha_japan">Kodansha Japan — official publisher</option>
          <option value="kodansha_usa">Kodansha USA — official publisher</option>
          <option value="viz_media">VIZ Media — official publisher</option>
          <option value="tokyopop_archive">TokyoPop archive — Open Library catalogue</option>
        </select>
      </label><label>
        Exact record URL
        <input minLength={12} onChange={(event) => { setQuery(event.target.value); setCandidates([]); setSelectedIds([]); }} placeholder={sourceInstructions[source].placeholder} required type="url" value={query} />
      </label></> : <label>
        Search title
        <input minLength={2} onChange={(event) => { setQuery(event.target.value); setCandidates([]); setSelectedIds([]); }} placeholder={sourceInstructions[source].placeholder} required value={query} />
      </label>}
      <div className="catalogue-form-actions">
        <button disabled={saving} type="submit">{saving ? "Importing…" : "Find candidates"}</button>
        {message ? <p role="status">{message}</p> : null}
      </div>
      <p className="catalogue-form-note">{sourceInstructions[source].description} {source === "shueisha" ? "Paste up to 25 ISBNs, one per line. Each result is still individually selected and reviewed." : ""} Nothing here becomes a verified edition automatically. Each candidate is checked in the catalogue review queue.</p>
      {candidates.length ? <div className="catalogue-form-actions catalogue-selection-actions"><button type="button" onClick={() => setSelectedIds((ids) => ids.length === candidates.length ? [] : candidates.map((candidate) => candidate.external_id))}>{selectedIds.length === candidates.length ? "Clear selection" : `Select all ${candidates.length} records`}</button><p>Use this only when every returned record is the exact candidate you intend to review.</p></div> : null}
      {candidates.length ? <div className="catalogue-options" aria-label="Source candidates">{candidates.map((candidate) => <label className={selectedIds.includes(candidate.external_id) ? "selected" : ""} key={candidate.external_id}><input type="checkbox" checked={selectedIds.includes(candidate.external_id)} onChange={() => setSelectedIds((ids) => ids.includes(candidate.external_id) ? ids.filter((id) => id !== candidate.external_id) : [...ids, candidate.external_id])} /><strong>{candidate.candidate_title}</strong><small>{[candidate.candidate_kind === "series_reference" ? "Series reference" : "Edition candidate", candidate.candidate_language, candidate.candidate_isbn_13, candidate.candidate_release_date].filter(Boolean).join(" · ")}</small><a href={candidate.source_record_url} target="_blank" rel="noreferrer">Open source ↗</a></label>)}</div> : null}
      {candidates.length ? <div className="catalogue-form-actions"><button type="button" disabled={saving} onClick={queueSelected}>Queue {selectedIds.length} selected record{selectedIds.length === 1 ? "" : "s"}</button><p>Select only records you can identify; unselected results never enter RAR.</p></div> : null}
    </form>
  );
}
