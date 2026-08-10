"use client";

import { useMemo, useState } from "react";

export type PrintClassificationRecord = {
  observation_id: string;
  edition_id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  listing_title: string | null;
  source_listing_url: string | null;
  sold_date: string | null;
  sale_price: number;
  currency: string;
  has_unreviewed_evidence_hint: boolean;
};

type Classification = "printing_not_identified" | "known_later_print" | "first_print_proven";

// Honest statements a reviewer picks, never claims the app makes on their
// behalf: each says what was looked at and what it did or did not show.
// Selecting one still leaves it editable before saving.
const NOTE_PRESETS: Array<{ classification: Classification; label: string; note: string }> = [
  { classification: "printing_not_identified", label: "No copyright page shown", note: "Listing photos do not include the copyright page, so the printing cannot be established from this sale." },
  { classification: "printing_not_identified", label: "Photos too unclear", note: "Copyright page is photographed but not legible enough to read the printing line." },
  { classification: "known_later_print", label: "Later printing shown", note: "Copyright page in the listing photos shows a printing line other than the first printing." },
];

function formatPrice(value: number, currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export default function PrintClassificationQueue({ records }: { records: PrintClassificationRecord[] }) {
  // Typed once and reused for every decision on the page, instead of being
  // re-entered on each row. Decisions update the list in place rather than
  // refreshing the route, so this survives a whole working session.
  const [reviewer, setReviewer] = useState("");
  // Classified sales are tracked as a set of ids and filtered out during
  // render, rather than copying `records` into state and mutating the copy
  // -- deriving avoids the prop/state sync that made the list go stale.
  const [classifiedIds, setClassifiedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [draftClassification, setDraftClassification] = useState<Classification>("printing_not_identified");
  const [proofUrl, setProofUrl] = useState("");
  const [printingNumber, setPrintingNumber] = useState("");
  const [note, setNote] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const rows = useMemo(() => records.filter((record) => !classifiedIds.has(record.observation_id)), [records, classifiedIds]);

  const presetsFor = useMemo(() => NOTE_PRESETS.filter((preset) => preset.classification === draftClassification), [draftClassification]);

  function resetDraft() {
    setOpenRow(null);
    setDraftClassification("printing_not_identified");
    setProofUrl("");
    setPrintingNumber("");
    setNote("");
  }

  function openFor(observationId: string, classification: Classification) {
    setOpenRow(observationId);
    setDraftClassification(classification);
    setProofUrl("");
    setPrintingNumber("");
    setNote("");
    setBanner(null);
  }

  async function save(observationIds: string[], classification: Classification, notes: string, options?: { proofUrl?: string; printingNumber?: string }) {
    if (!reviewer.trim()) { setBanner({ tone: "error", text: "Add your name or initials at the top before saving." }); return; }
    setBusy(true);
    setBanner(null);
    try {
      const response = await fetch("/api/print-classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          observationIds,
          classification,
          notes,
          reviewer,
          proofUrl: options?.proofUrl ?? "",
          printingNumber: options?.printingNumber ?? "",
        }),
      });
      const result = (await response.json()) as { error?: string; saved?: string[]; failed?: Array<{ observationId: string; error?: string }> };
      if (!response.ok) { setBanner({ tone: "error", text: result.error ?? "The classification could not be saved." }); return; }

      // Classified sales leave the queue immediately rather than waiting for
      // a refetch, so a reviewer can see progress through a long list.
      const savedIds = new Set(result.saved ?? observationIds);
      setClassifiedIds((current) => new Set([...current, ...savedIds]));
      setSelected((current) => {
        const next = new Set(current);
        for (const id of savedIds) next.delete(id);
        return next;
      });
      resetDraft();
      setBulkNote("");
      const failedCount = result.failed?.length ?? 0;
      setBanner({
        tone: failedCount ? "error" : "ok",
        text: failedCount
          ? `Saved ${savedIds.size}, but ${failedCount} could not be saved: ${result.failed?.[0]?.error ?? "unknown error"}`
          : `Saved ${savedIds.size} classification${savedIds.size === 1 ? "" : "s"}.`,
      });
    } catch {
      setBanner({ tone: "error", text: "The classification could not be saved. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  function toggle(observationId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(observationId)) next.delete(observationId); else next.add(observationId);
      return next;
    });
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;

  if (!rows.length) {
    return (
      <div className="review-empty">
        <strong>Nothing waiting on a printing decision.</strong>
        <p>Every edition-confirmed sale has been classified.</p>
      </div>
    );
  }

  return (
    <div className="print-queue">
      <div className="print-queue-reviewer">
        <label>
          Reviewer
          <input onChange={(event) => setReviewer(event.target.value)} placeholder="Your name or initials" value={reviewer} />
        </label>
        <small>Entered once for this session — every decision below is recorded under this name.</small>
      </div>

      {banner ? <p className={`print-queue-banner is-${banner.tone}`} role="status">{banner.text}</p> : null}

      <div className="print-queue-bulkbar">
        <label className="print-queue-selectall">
          <input
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.observation_id)))}
            type="checkbox"
          />
          {allSelected ? "Clear selection" : `Select all ${rows.length}`}
        </label>
        {selected.size ? (
          <>
            <strong>{selected.size} selected</strong>
            <input
              className="print-queue-bulknote"
              onChange={(event) => setBulkNote(event.target.value)}
              placeholder="Shared note (optional)"
              value={bulkNote}
            />
            <button disabled={busy} onClick={() => void save([...selected], "printing_not_identified", bulkNote)} type="button">
              Mark not identified
            </button>
            <button disabled={busy} onClick={() => setSelected(new Set())} type="button" className="is-clear">Clear</button>
          </>
        ) : (
          <span className="print-queue-hint">Select rows to classify several at once. First-print proof stays one at a time — it belongs to one exact copy.</span>
        )}
      </div>

      <ul className="print-queue-list">
        {rows.map((row) => {
          const isOpen = openRow === row.observation_id;
          return (
            <li className={`print-queue-row${selected.has(row.observation_id) ? " is-selected" : ""}`} key={row.observation_id}>
              <div className="print-queue-main">
                <input aria-label={`Select ${row.listing_title ?? "sale"}`} checked={selected.has(row.observation_id)} onChange={() => toggle(row.observation_id)} type="checkbox" />
                <div className="print-queue-detail">
                  <div className="print-queue-topline">
                    <strong>{formatPrice(row.sale_price, row.currency)}</strong>
                    <span>{formatDate(row.sold_date)}</span>
                    {row.has_unreviewed_evidence_hint ? <span className="print-queue-flag">Possible first-print claim</span> : null}
                  </div>
                  <p className="print-queue-listing">{row.listing_title ?? "Untitled marketplace listing"}</p>
                  <p className="print-queue-edition">
                    {[row.title, row.volume_number ? `Vol. ${row.volume_number}` : null, row.language, row.publisher].filter(Boolean).join(" · ")}
                    {row.source_listing_url ? <> · <a href={row.source_listing_url} target="_blank" rel="noreferrer">Open listing ↗</a></> : null}
                  </p>
                </div>
                <div className="print-queue-actions">
                  <button disabled={busy} onClick={() => openFor(row.observation_id, "printing_not_identified")} type="button">Not identified</button>
                  <button disabled={busy} onClick={() => openFor(row.observation_id, "known_later_print")} type="button">Later print</button>
                  <button className="is-first-print" disabled={busy} onClick={() => openFor(row.observation_id, "first_print_proven")} type="button">First print</button>
                </div>
              </div>

              {isOpen ? (
                <div className="print-queue-form">
                  {draftClassification === "first_print_proven" ? (
                    <label className="print-queue-proof">
                      Printing-proof URL <small>Required — a direct image of this copy&apos;s copyright page</small>
                      <input onChange={(event) => setProofUrl(event.target.value)} placeholder="https://… copyright-page image" type="url" value={proofUrl} />
                    </label>
                  ) : null}
                  {draftClassification === "known_later_print" ? (
                    <label className="print-queue-printing">
                      Known printing number <small>Optional</small>
                      <input inputMode="numeric" min={1} onChange={(event) => setPrintingNumber(event.target.value)} type="number" value={printingNumber} />
                    </label>
                  ) : null}
                  {presetsFor.length ? (
                    <div className="print-queue-presets">
                      {presetsFor.map((preset) => (
                        <button key={preset.label} onClick={() => setNote(preset.note)} type="button">{preset.label}</button>
                      ))}
                    </div>
                  ) : null}
                  <label className="print-queue-note">
                    Evidence note <small>Optional</small>
                    <textarea onChange={(event) => setNote(event.target.value)} placeholder="What the listing photos show about the printing." value={note} />
                  </label>
                  <div className="print-queue-save">
                    <button disabled={busy} onClick={() => void save([row.observation_id], draftClassification, note, { proofUrl, printingNumber })} type="button">
                      {busy ? "Saving…" : `Save as ${draftClassification === "first_print_proven" ? "first print" : draftClassification === "known_later_print" ? "later print" : "not identified"}`}
                    </button>
                    <button className="is-clear" disabled={busy} onClick={resetDraft} type="button">Cancel</button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
