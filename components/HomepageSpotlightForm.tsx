"use client";

import { FormEvent, useMemo, useState } from "react";

export type SpotlightEditionOption = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  cover_image_url: string | null;
};

export default function HomepageSpotlightForm({ editions, currentEditionId, currentAccent }: { editions: SpotlightEditionOption[]; currentEditionId: string | null; currentAccent: string }) {
  const [editionId, setEditionId] = useState(currentEditionId ?? editions[0]?.id ?? "");
  const [accentColor, setAccentColor] = useState(currentAccent);
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = useMemo(() => editions.find((edition) => edition.id === editionId) ?? null, [editionId, editions]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus("");
    const response = await fetch("/api/homepage-spotlight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ editionId, accentColor, reviewer, note }),
    });
    const body = await response.json() as { error?: string };
    setSaving(false);
    if (!response.ok) {
      setStatus(body.error ?? "RAR could not update the spotlight.");
      return;
    }
    setStatus("Edition of the Week updated. The homepage now uses this selection.");
    setNote("");
  }

  return (
    <form className="catalogue-import-form" onSubmit={submit}>
      <label className="catalogue-notes-wide">
        <span>Edition</span>
        <select value={editionId} onChange={(event) => setEditionId(event.target.value)} required>
          {editions.map((edition) => (
            <option value={edition.id} key={edition.id}>
              {[edition.series || edition.title || "Untitled", edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.publisher, edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null].filter(Boolean).join(" · ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Cover-matched accent</span>
        <input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} />
      </label>
      <label>
        <span>Reviewer</span>
        <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Your name" required />
      </label>
      <label className="catalogue-notes-wide">
        <span>Selection note</span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why this edition is being featured (optional)" rows={3} />
      </label>
      {selected ? (
        <div className="selected-edition catalogue-notes-wide">
          {/* eslint-disable-next-line @next/next/no-img-element -- verified publisher covers use multiple remote hosts */}
          {selected.cover_image_url ? <img alt="" src={selected.cover_image_url} /> : null}
          <div><strong>{selected.title ?? selected.series ?? "Untitled edition"}</strong><p>{[selected.series, selected.volume_number ? `Vol. ${selected.volume_number}` : null, selected.language, selected.publisher].filter(Boolean).join(" · ")}</p></div>
        </div>
      ) : null}
      <div className="catalogue-form-actions catalogue-notes-wide">
        <button disabled={saving || !editionId} type="submit">{saving ? "Updating…" : "Set Edition of the Week"}</button>
        {status ? <p aria-live="polite">{status}</p> : null}
      </div>
    </form>
  );
}
