"use client";

import { useEffect, useMemo, useState } from "react";

export type PriceReviewRecord = {
  observation_id: string;
  listing_title: string | null;
  source_listing_url: string | null;
  sold_date: string | null;
  sale_price: number | null;
  currency: string | null;
  match_notes: string | null;
  edition_title: string | null;
  edition_series: string | null;
  edition_volume_number: string | null;
  edition_language: string | null;
  edition_isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  source_name: string | null;
  evidence_image_url: string | null;
  print_classification: "printing_not_identified" | "known_later_print" | "first_print_proven";
};

type Decision = "verified_match" | "excluded";

function formatPrice(value: number | null, currency: string | null) {
  if (value === null || !currency) return "Price not recorded";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function PriceReviewQueue({ records }: { records: PriceReviewRecord[] }) {
  const [reviewer, setReviewer] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("rar_staff_reviewer") ?? "");
  const [resolved, setResolved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const rows = useMemo(() => records.filter((record) => !resolved.has(record.observation_id)), [records, resolved]);

  useEffect(() => { if (reviewer.trim()) window.sessionStorage.setItem("rar_staff_reviewer", reviewer.trim()); }, [reviewer]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function save(observationIds: string[], decision: Decision, options?: { notes?: string; firstPrintProof?: string }) {
    if (!reviewer.trim()) { setBanner({ tone: "error", text: "Add your name or initials once at the top before reviewing." }); return; }
    setBusy(true);
    setBanner(null);
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observationIds,
          decision,
          reviewer,
          notes: options?.notes ?? "",
          printClassification: options?.firstPrintProof ? "first_print_proven" : "",
          proofUrl: options?.firstPrintProof ?? "",
          printingNumber: options?.firstPrintProof ? "1" : "",
        }),
      });
      const result = await response.json() as { error?: string; saved?: string[]; failed?: Array<{ observationId: string; error?: string }> };
      if (!response.ok) { setBanner({ tone: "error", text: result.error ?? "The review could not be saved." }); return; }
      const savedIds = new Set(result.saved ?? observationIds);
      setResolved((current) => new Set([...current, ...savedIds]));
      setSelected((current) => new Set([...current].filter((id) => !savedIds.has(id))));
      const failedCount = result.failed?.length ?? 0;
      setBanner({
        tone: failedCount ? "error" : "ok",
        text: failedCount ? `Saved ${savedIds.size}; ${failedCount} failed: ${result.failed?.[0]?.error ?? "unknown error"}` : `Saved ${savedIds.size} review decision${savedIds.size === 1 ? "" : "s"}.`,
      });
    } catch {
      setBanner({ tone: "error", text: "The review could not be saved. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;
  if (!rows.length) return <div className="review-empty"><strong>The queue is clear.</strong><p>New candidate sales will appear here before they can affect RAR values.</p></div>;

  return <div className="price-review-workbench">
    <div className="price-review-toolbar">
      <label>Reviewer<input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" value={reviewer} /></label>
      <small>Entered once for this session. Every decision still receives its own audit row.</small>
    </div>
    {banner ? <p className={`print-queue-banner is-${banner.tone}`} role="status">{banner.text}</p> : null}
    <div className="price-review-bulkbar">
      <label><input checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.observation_id)))} type="checkbox" />{allSelected ? "Clear all" : `Select all ${rows.length}`}</label>
      {selected.size ? <>
        <strong>{selected.size} selected</strong>
        <button disabled={busy} onClick={() => void save([...selected], "verified_match")} type="button">Verify selected</button>
        <button className="is-exclude" disabled={busy} onClick={() => void save([...selected], "excluded")} type="button">Exclude selected</button>
        <button className="is-clear" disabled={busy} onClick={() => setSelected(new Set())} type="button">Clear</button>
      </> : <span>Select obvious exact matches or exclusions and clear them together.</span>}
    </div>
    <div className="review-list">
      {rows.map((record) => {
        const note = notes[record.observation_id] ?? "";
        return <article className={`review-card price-review-card${selected.has(record.observation_id) ? " is-selected" : ""}`} key={record.observation_id}>
          <div className="review-card-topline">
            <label className="price-review-select"><input checked={selected.has(record.observation_id)} onChange={() => toggle(record.observation_id)} type="checkbox" />Select</label>
            <span>{record.source_name ?? "Marketplace sale"}</span><time>{formatDate(record.sold_date)}</time>
          </div>
          <div className="review-card-main">
            <div><h3>{record.listing_title ?? "Untitled marketplace listing"}</h3><strong className="review-price">{formatPrice(record.sale_price, record.currency)}</strong></div>
            <div className="price-review-links">
              {record.source_listing_url ? <a className="review-source-link" href={record.source_listing_url} target="_blank" rel="noreferrer">Open original listing ↗</a> : null}
              {record.evidence_image_url ? <a className="review-source-link" href={record.evidence_image_url} target="_blank" rel="noreferrer">Open copyright proof ↗</a> : null}
            </div>
          </div>
          <div className="review-match">
            <p className="eyebrow">Proposed edition</p><h4>{record.edition_title ?? "No edition linked yet"}</h4>
            <p>{[record.edition_series, record.edition_volume_number ? `Vol. ${record.edition_volume_number}` : null, record.edition_language].filter(Boolean).join(" · ")}</p>
            <dl>{record.edition_isbn_13 ? <div><dt>ISBN</dt><dd>{record.edition_isbn_13}</dd></div> : null}{record.printing_number ? <div><dt>Printing</dt><dd>{record.printing_number}</dd></div> : null}{record.edition_statement ? <div><dt>Edition</dt><dd>{record.edition_statement}</dd></div> : null}</dl>
            {record.match_notes ? <p className="price-review-reason"><strong>Why it was queued:</strong> {record.match_notes}</p> : null}
          </div>
          <label className="price-review-note">Evidence note <small>Optional</small><textarea onChange={(event) => setNotes((current) => ({ ...current, [record.observation_id]: event.target.value }))} placeholder="Only add context when the source is not self-explanatory." value={note} /></label>
          <div className="price-review-actions">
            <button disabled={busy} onClick={() => void save([record.observation_id], "verified_match", { notes: note })} type="button">Verify exact match</button>
            {record.evidence_image_url && record.print_classification === "printing_not_identified" ? <button className="is-first-print" disabled={busy} onClick={() => void save([record.observation_id], "verified_match", { notes: note, firstPrintProof: record.evidence_image_url ?? undefined })} type="button">Verify + first print</button> : null}
            <button className="is-exclude" disabled={busy} onClick={() => void save([record.observation_id], "excluded", { notes: note })} type="button">Exclude</button>
          </div>
        </article>;
      })}
    </div>
  </div>;
}
