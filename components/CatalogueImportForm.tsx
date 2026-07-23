"use client";

import { useState } from "react";

type CatalogueSource = "open_library" | "mangadex";

export default function CatalogueImportForm() {
  const [source, setSource] = useState<CatalogueSource>("open_library");
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function importCandidates(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/catalogue-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, query }),
      });
      const result = (await response.json()) as { error?: string; message?: string };
      setMessage(result.error ?? result.message ?? "Candidates were queued for review.");
    } catch {
      setMessage("The catalogue source could not be reached. Please try again.");
    } finally {
      setSaving(false);
    }
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
        <input minLength={2} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. One Piece" required value={query} />
      </label>
      <div className="catalogue-form-actions">
        <button disabled={saving} type="submit">{saving ? "Importing…" : "Find candidates"}</button>
        {message ? <p role="status">{message}</p> : null}
      </div>
      <p className="catalogue-form-note">Nothing here becomes a verified edition automatically. Each candidate is checked in the catalogue review queue.</p>
    </form>
  );
}
