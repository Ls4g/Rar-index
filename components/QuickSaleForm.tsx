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
  const [listingImageUrls, setListingImageUrls] = useState<string[]>([]);
  const [loadingListingImages, setLoadingListingImages] = useState(false);
  const [intakeNotes, setIntakeNotes] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [verifyExactMatch, setVerifyExactMatch] = useState(false);
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

  function changeListingUrl(value: string) {
    if (listingImageUrls.includes(evidenceImageUrl)) setEvidenceImageUrl("");
    setListingImageUrls([]);
    setSourceListingUrl(value);
  }

  async function loadListingPhotos() {
    if (!sourceListingUrl.trim()) {
      setMessage("Paste the original eBay item link before loading its photos.");
      return;
    }
    setLoadingListingImages(true);
    setMessage("");
    try {
      const response = await fetch(`/api/add-sale?listingUrl=${encodeURIComponent(sourceListingUrl.trim())}`);
      const data = await response.json() as { externalId?: string; title?: string; imageUrls?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The listing photos could not be loaded.");
      setListingImageUrls(data.imageUrls ?? []);
      if (!externalId.trim() && data.externalId) setExternalId(data.externalId);
      if (!listingTitle.trim() && data.title) setListingTitle(data.title);
      setMessage(data.imageUrls?.length
        ? "Choose the photo that visibly proves the printing. RAR will never choose one automatically."
        : "eBay returned the listing but no photos. Paste a direct copyright-page image link instead.");
    } catch (error) {
      setListingImageUrls([]);
      setMessage(error instanceof Error ? error.message : "The listing photos could not be loaded.");
    } finally {
      setLoadingListingImages(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEdition) { setMessage("Choose the exact RAR edition first."); return; }
    if ((classifying || verifyExactMatch) && !reviewer.trim()) { setMessage("Enter your name before verifying or classifying this sale."); return; }
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
          verifyExactMatch,
          printClassification,
          knownPrintingNumber,
        }),
      });
      const data = await response.json() as { observationId?: string; verified?: boolean; classified?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The sale could not be queued.");
      setMessage(data.verified
        ? `Sale saved${data.classified ? ", print classified," : ""} and verified as public market evidence.`
        : classifying ? "Saved to the review queue and print classified. It still needs exact-edition review." : "Saved to the review queue. It is not public market evidence yet.");
      setExternalId("");
      setSourceListingUrl("");
      setListingTitle("");
      setSoldDate("");
      setSalePrice("");
      setEvidenceImageUrl("");
      setListingImageUrls([]);
      setIntakeNotes("");
      setPrintClassification("printing_not_identified");
      setKnownPrintingNumber("");
      setVerifyExactMatch(false);
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
        <label className="quick-sale-wide">Original completed-listing link<input required type="url" value={sourceListingUrl} onChange={(event) => changeListingUrl(event.target.value)} placeholder="https://..." /></label>
        <div className="quick-sale-wide evidence-photo-loader">
          <button type="button" disabled={loadingListingImages || !sourceListingUrl.trim()} onClick={loadListingPhotos}>{loadingListingImages ? "Loading eBay photos..." : "Load eBay listing photos"}</button>
          <p>Select only a photo that clearly shows the copyright or printing page for this exact sold copy. If eBay no longer exposes the photos, use the proof-link field below.</p>
        </div>
        {listingImageUrls.length ? <div className="quick-sale-wide evidence-photo-grid" aria-label="eBay listing photos">
          {listingImageUrls.map((imageUrl, index) => <button className={evidenceImageUrl === imageUrl ? "selected" : ""} type="button" key={imageUrl} onClick={() => setEvidenceImageUrl(imageUrl)} aria-pressed={evidenceImageUrl === imageUrl}>
            {/* Seller listing photos are remote evidence, not RAR catalogue artwork. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt={`eBay listing photo ${index + 1}`} />
            <span>{evidenceImageUrl === imageUrl ? "Selected as proof" : "Use as copyright proof"}</span>
          </button>)}
        </div> : null}
        <label>Marketplace listing ID<input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Auto-read from eBay link when possible" /></label>
        <label>Sold date<input required type="date" value={soldDate} onChange={(event) => setSoldDate(event.target.value)} /></label>
        <label className="quick-sale-wide">Listing title<input required value={listingTitle} onChange={(event) => setListingTitle(event.target.value)} placeholder="Copy the title exactly as shown" /></label>
        <label>Sold price<input required inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="0.00" /></label>
        <label>Currency<input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="GBP" /></label>
        <label className="quick-sale-wide">Copyright-page proof link <small>Selected eBay photos appear here automatically. Required to classify this sale as a proven first print.</small><input type="url" value={evidenceImageUrl} onChange={(event) => setEvidenceImageUrl(event.target.value)} placeholder="https://..." /></label>
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
        <label className="quick-sale-wide">Your name / initials <small>{classifying || verifyExactMatch ? "Required for the audited decision." : "Optional unless verifying or classifying."}</small><input required={classifying || verifyExactMatch} value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="Reviewer name" /></label>
      </div>
      <label className="quick-sale-verify">
        <input checked={verifyExactMatch} onChange={(event) => setVerifyExactMatch(event.target.checked)} type="checkbox" />
        <span><strong>I inspected the source and this is the exact RAR edition</strong><small>Save and verify now instead of creating another review task. The named decision remains in RAR&apos;s audit history.</small></span>
      </label>
      <div className="quick-sale-submit"><button type="submit" disabled={loading}>{loading ? "Saving..." : verifyExactMatch ? "Save and verify sale" : "Queue sale for review"}</button><p>{verifyExactMatch ? "This publishes the sale as verified evidence immediately." : "Use the review queue when the edition match needs another look."}</p></div>
    </> : null}
    {message ? <p className="quick-sale-message" role="status">{message}</p> : null}
  </form>;
}
