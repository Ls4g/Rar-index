"use client";

import { useEffect, useState } from "react";

type Edition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  printing_number: number | null;
  edition_statement: string | null;
  variant_name: string | null;
};
type Source = { id: string; name: string | null };

function editionLabel(edition: Edition) {
  return [
    edition.title,
    edition.series,
    edition.volume_number ? `Vol. ${edition.volume_number}` : null,
    edition.language,
    edition.printing_number ? `Printing ${edition.printing_number}` : null,
    edition.edition_statement,
    edition.variant_name,
    edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null,
  ].filter(Boolean).join(" | ");
}

export default function QuickSaleForm({ initialEditionId = "" }: { initialEditionId?: string }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Edition[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourceListingUrl, setSourceListingUrl] = useState("");
  const [externalId, setExternalId] = useState("");
  const [listingTitle, setListingTitle] = useState("");
  const [soldDate, setSoldDate] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [saleType, setSaleType] = useState("unknown");
  const [evidenceImageUrl, setEvidenceImageUrl] = useState("");
  const [intakeNotes, setIntakeNotes] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [printClassification, setPrintClassification] = useState<"printing_not_identified" | "known_later_print" | "first_print_proven">("printing_not_identified");
  const [knownPrintingNumber, setKnownPrintingNumber] = useState("");
  const classifying = printClassification !== "printing_not_identified";
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const visibleSuggestions = query.trim().length >= 2 && !selectedEdition ? suggestions : [];

  useEffect(() => {
    if (!initialEditionId || selectedEdition) return;
    const controller = new AbortController();
    fetch(`/api/add-sale?editionId=${encodeURIComponent(initialEditionId)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { edition?: Edition; sources?: Source[]; error?: string };
        if (!response.ok || !data.edition) throw new Error(data.error ?? "The selected edition could not be loaded.");
        setSelectedEdition(data.edition);
        setSources(data.sources ?? []);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "The selected edition could not be loaded.");
      });
    return () => controller.abort();
  }, [initialEditionId, selectedEdition]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      if (selectedEdition || query.trim().length < 2) return;
      try {
        const response = await fetch(`/api/add-sale?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = await response.json() as { editions?: Edition[]; sources?: Source[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Edition suggestions could not be loaded.");
        setSuggestions(data.editions ?? []);
        setSources(data.sources ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Edition suggestions could not be loaded.");
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectedEdition]);

  useEffect(() => {
    if (!selectedEdition) return;
    const controller = new AbortController();
    fetch(`/api/add-sale?editionId=${encodeURIComponent(selectedEdition.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { sources?: Source[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Sale sources could not be loaded.");
        setSources(data.sources ?? []);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Sale sources could not be loaded.");
      });
    return () => controller.abort();
  }, [selectedEdition]);

  function selectEdition(edition: Edition) {
    setSelectedEdition(edition);
    setSuggestions([]);
    setMessage("");
  }

  function resetEdition() {
    setSelectedEdition(null);
    setQuery("");
    setSources([]);
    setSourceId("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEdition) { setMessage("Choose the exact RAR edition first."); return; }
    if (classifying && !reviewer.trim()) { setMessage("Enter your name before classifying the printing — it is required for that audited decision."); return; }
    if (printClassification === "first_print_proven" && !evidenceImageUrl.trim()) { setMessage("A first-print classification requires the copyright-page proof link above."); return; }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/add-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          editionId: selectedEdition.id,
          sourceId,
          sourceListingUrl,
          externalId,
          listingTitle,
          soldDate,
          salePrice,
          currency,
          saleType,
          evidenceImageUrl,
          intakeNotes,
          reviewer,
          printClassification,
          knownPrintingNumber,
        }),
      });
      const data = await response.json() as { observationId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The sale could not be queued.");
      setMessage(classifying ? "Saved to the review queue and classified. It still needs edition-match review before it is public market evidence." : "Saved to the review queue. It is not public market evidence yet.");
      setExternalId("");
      setSourceListingUrl("");
      setListingTitle("");
      setSoldDate("");
      setSalePrice("");
      setEvidenceImageUrl("");
      setIntakeNotes("");
      setPrintClassification("printing_not_identified");
      setKnownPrintingNumber("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The sale could not be queued.");
    } finally {
      setLoading(false);
    }
  }

  return <form className="quick-sale-form" onSubmit={submit}>
    <div className="quick-sale-step"><span>1</span><div><strong>Select the exact RAR edition</strong><p>Sales only ever attach to one existing, verified edition record.</p></div></div>
    <div className="price-import-field">
      {selectedEdition ? <div className="selected-edition"><strong>{editionLabel(selectedEdition)}</strong><button type="button" onClick={resetEdition}>Change edition</button></div> : <>
        <label htmlFor="quick-sale-edition">Search a verified RAR edition</label>
        <input id="quick-sale-edition" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing an edition title" autoComplete="off" />
        {visibleSuggestions.length ? <div className="edition-suggestions">{visibleSuggestions.map((edition) => <button type="button" key={edition.id} onClick={() => selectEdition(edition)}>{editionLabel(edition)}</button>)}</div> : null}
      </>}
    </div>
    {selectedEdition ? <>
      <div className="quick-sale-step"><span>2</span><div><strong>Capture the original completed sale</strong><p>The original marketplace link is the evidence. A Scout scan is not required.</p></div></div>
      <div className="quick-sale-grid">
        <label>Marketplace source<select required value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name ?? "Unnamed marketplace"}</option>)}</select></label>
        <label>Sale type<select value={saleType} onChange={(event) => setSaleType(event.target.value)}><option value="unknown">Unknown</option><option value="auction">Auction</option><option value="fixed_price">Fixed price</option><option value="best_offer">Best offer</option></select></label>
        <label className="quick-sale-wide">Original completed-listing link<input required type="url" value={sourceListingUrl} onChange={(event) => setSourceListingUrl(event.target.value)} placeholder="https://..." /></label>
        <label>Marketplace listing ID<input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Auto-read from eBay link when possible" /></label>
        <label>Sold date<input required type="date" value={soldDate} onChange={(event) => setSoldDate(event.target.value)} /></label>
        <label className="quick-sale-wide">Listing title<input required value={listingTitle} onChange={(event) => setListingTitle(event.target.value)} placeholder="Copy the title exactly as shown" /></label>
        <label>Sold price<input required inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="0.00" /></label>
        <label>Currency<input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="GBP" /></label>
        <label className="quick-sale-wide">Copyright-page proof link <small>Required to classify this sale as a proven first print.</small><input type="url" value={evidenceImageUrl} onChange={(event) => setEvidenceImageUrl(event.target.value)} placeholder="https://..." /></label>
        <label className="quick-sale-wide">Intake note <small>Optional; add context only when the source does not make the decision clear.</small><textarea value={intakeNotes} onChange={(event) => setIntakeNotes(event.target.value)} placeholder="What did you check before adding this?" rows={3} /></label>
      </div>
      <div className="quick-sale-step"><span>3</span><div><strong>Classify the printing</strong><p>Never inferred automatically. Printing not identified is the safe default — only change it with direct evidence for this exact copy.</p></div></div>
      <div className="quick-sale-grid">
        <label>Print classification<select value={printClassification} onChange={(event) => setPrintClassification(event.target.value as typeof printClassification)}>
          <option value="printing_not_identified">Printing not identified (default)</option>
          <option value="known_later_print">Known later printing</option>
          <option value="first_print_proven">First print — proven</option>
        </select></label>
        <label>Known printing number <small>Optional</small><input inputMode="numeric" min={1} type="number" value={knownPrintingNumber} onChange={(event) => setKnownPrintingNumber(event.target.value)} placeholder="e.g. 1" /></label>
        <label className="quick-sale-wide">Your name / initials <small>{classifying ? "Required to classify a printing — this is an audited decision." : "Optional unless classifying the printing."}</small><input required={classifying} value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Reviewer name" /></label>
      </div>
      <div className="quick-sale-submit"><button type="submit" disabled={loading}>{loading ? "Saving..." : "Queue sale for review"}</button><p>After saving, open the review queue and verify or exclude it against the original source. A printing classification here still needs edition-match review before it shows publicly.</p></div>
    </> : null}
    {message ? <p className="quick-sale-message" role="status">{message}</p> : null}
  </form>;
}
