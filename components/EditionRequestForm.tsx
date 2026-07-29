"use client";

import { useState } from "react";

const collectibleTypes = [
  ["tankobon", "Tankobon / volume"],
  ["zasshi", "Zasshi / magazine"],
  ["convention_exclusive", "Convention exclusive"],
  ["promo_variant", "Promo / variant"],
  ["graded", "Graded collectible"],
] as const;

const blankValues = {
  requestedTitle: "",
  series: "",
  volumeNumber: "",
  language: "",
  publisher: "",
  isbn13: "",
  collectibleType: "tankobon",
  sourceUrl: "",
  copyrightEvidenceUrl: "",
  notes: "",
  website: "",
};

export default function EditionRequestForm() {
  const [values, setValues] = useState(blankValues);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const update = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/edition-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The request could not be sent.");
      setMessage("Thank you. Your edition request is now in RAR research queue; it will not publish automatically.");
      setValues(blankValues);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be sent.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="edition-request-form" onSubmit={submit}>
      <label>Title or item name<input required value={values.requestedTitle} onChange={(event) => update("requestedTitle", event.target.value)} maxLength={300} placeholder="e.g. Weekly Shonen Jump 1997 No. 34" /></label>
      <label>Collectible type<select value={values.collectibleType} onChange={(event) => update("collectibleType", event.target.value)}>{collectibleTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Series <span>(optional)</span><input value={values.series} onChange={(event) => update("series", event.target.value)} maxLength={300} placeholder="e.g. One Piece" /></label>
      <label>Volume / issue <span>(optional)</span><input value={values.volumeNumber} onChange={(event) => update("volumeNumber", event.target.value)} maxLength={80} placeholder="Vol. 1, No. 34, etc." /></label>
      <label>Language <span>(optional)</span><input value={values.language} onChange={(event) => update("language", event.target.value)} maxLength={80} placeholder="Japanese, English, etc." /></label>
      <label>Publisher <span>(optional)</span><input value={values.publisher} onChange={(event) => update("publisher", event.target.value)} maxLength={200} placeholder="Shueisha, VIZ Media, etc." /></label>
      <label>ISBN <span>(optional)</span><input value={values.isbn13} onChange={(event) => update("isbn13", event.target.value)} maxLength={20} placeholder="978..." /></label>
      <label>Original source URL <span>(optional but strongly preferred)</span><input type="url" value={values.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} placeholder="https://..." /></label>
      <label>Copyright-page image URL <span>(optional)</span><input type="url" value={values.copyrightEvidenceUrl} onChange={(event) => update("copyrightEvidenceUrl", event.target.value)} placeholder="Direct image link, if available" /></label>
      <label className="request-notes">Why should RAR add or research it?<textarea required minLength={20} maxLength={3000} value={values.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Tell us what the source proves, what makes it notable, or what needs identifying." /></label>
      <label className="report-honeypot" aria-hidden="true">Website<input tabIndex={-1} autoComplete="off" value={values.website} onChange={(event) => update("website", event.target.value)} /></label>
      <div className="edition-request-actions"><button disabled={saving} type="submit">{saving ? "Sending..." : "Send research request"}</button>{message ? <p role="status">{message}</p> : null}</div>
    </form>
  );
}
