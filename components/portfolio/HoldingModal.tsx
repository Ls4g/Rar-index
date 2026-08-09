"use client";

import { FormEvent, useEffect, useRef } from "react";
import type { HoldingEdition } from "@/components/portfolio/HoldingCard";

function editionLabel(edition: HoldingEdition) {
  return [
    edition.title,
    edition.volume_number ? `Vol. ${edition.volume_number}` : null,
    edition.language,
    edition.printing_number ? `Printing ${edition.printing_number}` : edition.edition_statement,
    edition.variant_name,
    edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null,
  ].filter(Boolean).join(" | ");
}

type HoldingModalProps = {
  open: boolean;
  editingId: string | null;
  query: string;
  setQuery: (value: string) => void;
  suggestions: HoldingEdition[];
  selectedEdition: HoldingEdition | null;
  onSelectEdition: (edition: HoldingEdition) => void;
  onChangeEdition: () => void;
  quantity: string;
  setQuantity: (value: string) => void;
  purchasePrice: string;
  setPurchasePrice: (value: string) => void;
  purchaseCurrency: string;
  setPurchaseCurrency: (value: string) => void;
  purchaseDate: string;
  setPurchaseDate: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  saving: boolean;
  message: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

export default function HoldingModal({
  open, editingId, query, setQuery, suggestions, selectedEdition, onSelectEdition, onChangeEdition,
  quantity, setQuantity, purchasePrice, setPurchasePrice, purchaseCurrency, setPurchaseCurrency,
  purchaseDate, setPurchaseDate, notes, setNotes, saving, message, onSubmit, onClose,
}: HoldingModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    firstFieldRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const visibleSuggestions = !selectedEdition && query.trim().length >= 2 ? suggestions : [];

  return (
    <div className="holding-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div aria-labelledby="holding-modal-title" aria-modal="true" className="holding-modal" ref={dialogRef} role="dialog">
        <div className="holding-modal-head">
          <p className="eyebrow">{editingId ? "Edit holding" : "Add to portfolio"}</p>
          <h2 id="holding-modal-title">{editingId ? "Update holding" : "Track an edition"}</h2>
          <button aria-label="Close" className="holding-modal-close" onClick={onClose} type="button">×</button>
        </div>
        <p className="holding-modal-intro">Only verified RAR publications can be added. Raw condition remains on the original sale source; it is not a portfolio valuation field.</p>
        <form onSubmit={onSubmit}>
          <label>RAR edition
            {selectedEdition ? (
              <div className="portfolio-selected-edition">
                <strong>{editionLabel(selectedEdition)}</strong>
                <button onClick={onChangeEdition} type="button">Change</button>
              </div>
            ) : (
              <>
                <input autoComplete="off" onChange={(event) => setQuery(event.target.value)} placeholder="Search title or ISBN" ref={firstFieldRef} value={query} />
                {visibleSuggestions.length ? (
                  <div className="portfolio-suggestions">
                    {visibleSuggestions.map((edition) => <button key={edition.id} onClick={() => onSelectEdition(edition)} type="button">{editionLabel(edition)}</button>)}
                  </div>
                ) : null}
              </>
            )}
          </label>
          <label>Quantity<input min="1" onChange={(event) => setQuantity(event.target.value)} required step="1" type="number" value={quantity} /></label>
          <label>Purchase price per copy <small>Optional</small><input min="0" onChange={(event) => setPurchasePrice(event.target.value)} step="0.01" type="number" value={purchasePrice} /></label>
          <label>Purchase currency<input disabled={!purchasePrice.trim()} maxLength={3} onChange={(event) => setPurchaseCurrency(event.target.value.toUpperCase())} value={purchaseCurrency} /></label>
          <label>Purchase date <small>Optional</small><input onChange={(event) => setPurchaseDate(event.target.value)} type="date" value={purchaseDate} /></label>
          <label>Notes <small>Optional</small><textarea onChange={(event) => setNotes(event.target.value)} placeholder="Where you found it, personal note, etc." value={notes} /></label>
          <div className="portfolio-form-actions">
            <button disabled={saving} type="submit">{saving ? "Saving..." : editingId ? "Save holding" : "Add holding"}</button>
            <button className="portfolio-text-button" onClick={onClose} type="button">Cancel</button>
          </div>
          {message ? <p role="status">{message}</p> : null}
        </form>
      </div>
    </div>
  );
}
