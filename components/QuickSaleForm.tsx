"use client";

import { useEffect, useMemo, useState } from "react";
import { extractEbayLegacyItemId } from "@/lib/ebayEvidence";
import { detectGrading, detectsBestOffer, parseSubmittedSaleText } from "@/lib/submittedSale";

type Edition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  printing_number: number | null;
  edition_statement: string | null;
  variant_name: string | null;
};
type Source = { id: string; name: string | null };
type PrintClassification = "printing_not_identified" | "known_later_print" | "first_print_proven";
type SaleType = "unknown" | "auction" | "fixed_price" | "best_offer";

function editionLabel(edition: Edition) {
  return [
    edition.title,
    edition.series,
    edition.volume_number ? `Vol. ${edition.volume_number}` : null,
    edition.language,
    edition.publisher,
    edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null,
  ].filter(Boolean).join(" | ");
}

export default function QuickSaleForm({ initialEditionId = "" }: { initialEditionId?: string }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Edition[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [submittedText, setSubmittedText] = useState("");
  const [sourceListingUrl, setSourceListingUrl] = useState("");
  const [externalId, setExternalId] = useState("");
  const [listingTitle, setListingTitle] = useState("");
  const [soldDate, setSoldDate] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [shippingPrice, setShippingPrice] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [quantity, setQuantity] = useState("1");
  const [saleType, setSaleType] = useState<SaleType>("unknown");
  const [priceCorroborationUrl, setPriceCorroborationUrl] = useState("");
  const [isGraded, setIsGraded] = useState(false);
  const [gradingCompany, setGradingCompany] = useState("");
  const [gradeLabel, setGradeLabel] = useState("");
  const [printClassification, setPrintClassification] = useState<PrintClassification>("printing_not_identified");
  const [printingProofUrl, setPrintingProofUrl] = useState("");
  const [knownPrintingNumber, setKnownPrintingNumber] = useState("");
  const [intakeNotes, setIntakeNotes] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [humanConfirmed, setHumanConfirmed] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const visibleSuggestions = query.trim().length >= 2 && !selectedEdition ? suggestions : [];
  const liveDetection = useMemo(() => {
    const text = `${listingTitle}\n${submittedText}`;
    return { grading: detectGrading(text), bestOffer: detectsBestOffer(text) };
  }, [listingTitle, submittedText]);

  useEffect(() => {
    const saved = window.sessionStorage.getItem("rar-sale-reviewer");
    if (!saved) return;
    const timer = window.setTimeout(() => setReviewer(saved), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (reviewer.trim()) window.sessionStorage.setItem("rar-sale-reviewer", reviewer.trim());
  }, [reviewer]);

  useEffect(() => {
    if (!initialEditionId || selectedEdition) return;
    const controller = new AbortController();
    fetch(`/api/add-sale?editionId=${encodeURIComponent(initialEditionId)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { edition?: Edition; sources?: Source[]; error?: string };
        if (!response.ok || !data.edition) throw new Error(data.error ?? "The selected edition could not be loaded.");
        setSelectedEdition(data.edition);
        const nextSources = data.sources ?? [];
        setSources(nextSources);
        setSourceId((current) => current || nextSources.find((source) => source.name === "eBay Sold")?.id || "");
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
        const nextSources = data.sources ?? [];
        setSources(nextSources);
        setSourceId((current) => current || nextSources.find((source) => source.name === "eBay Sold")?.id || "");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Edition suggestions could not be loaded.");
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectedEdition]);

  function selectEdition(edition: Edition) {
    setSelectedEdition(edition);
    setSuggestions([]);
    setMessage("");
  }

  function resetEdition() {
    setSelectedEdition(null);
    setQuery("");
  }

  function changeListingUrl(value: string) {
    setSourceListingUrl(value);
    const itemId = extractEbayLegacyItemId(value);
    if (itemId) setExternalId(itemId);
  }

  function usePastedEvidence() {
    if (!submittedText.trim()) {
      setMessage("Paste the visible completed-listing details first.");
      return;
    }
    const parsed = parseSubmittedSaleText(submittedText);
    if (parsed.sourceListingUrl) changeListingUrl(parsed.sourceListingUrl);
    if (parsed.listingTitle) setListingTitle(parsed.listingTitle);
    if (parsed.soldDate) setSoldDate(parsed.soldDate);
    if (parsed.salePrice) setSalePrice(parsed.salePrice);
    if (parsed.shippingPrice) setShippingPrice(parsed.shippingPrice);
    if (parsed.currency) setCurrency(parsed.currency);
    if (parsed.quantity) setQuantity(parsed.quantity);
    if (parsed.saleType !== "unknown") setSaleType(parsed.saleType);
    setIsGraded(parsed.grading.isGraded);
    if (parsed.grading.company) setGradingCompany(parsed.grading.company);
    if (parsed.grading.grade) setGradeLabel(parsed.grading.grade);
    setMessage("RAR filled what it could from your pasted evidence. Check every field before approval.");
  }

  function applyTitleSignals() {
    if (liveDetection.grading.isGraded) {
      setIsGraded(true);
      if (!gradingCompany && liveDetection.grading.company) setGradingCompany(liveDetection.grading.company);
      if (!gradeLabel && liveDetection.grading.grade) setGradeLabel(liveDetection.grading.grade);
    }
    if (liveDetection.bestOffer && saleType === "unknown") setSaleType("best_offer");
  }

  function clearSale() {
    setSubmittedText("");
    setSourceListingUrl("");
    setExternalId("");
    setListingTitle("");
    setSoldDate("");
    setSalePrice("");
    setShippingPrice("");
    setQuantity("1");
    setSaleType("unknown");
    setPriceCorroborationUrl("");
    setIsGraded(false);
    setGradingCompany("");
    setGradeLabel("");
    setPrintClassification("printing_not_identified");
    setPrintingProofUrl("");
    setKnownPrintingNumber("");
    setIntakeNotes("");
    setHumanConfirmed(false);
    setRejectionReason("");
  }

  function commonPayload() {
    return {
      editionId: selectedEdition?.id,
      sourceId,
      submittedText,
      sourceListingUrl,
      externalId,
      listingTitle,
      reviewer,
      intakeNotes,
    };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEdition) { setMessage("Choose the exact RAR edition first."); return; }
    if (!reviewer.trim()) { setMessage("Enter your name or initials."); return; }
    if (!humanConfirmed) { setMessage("Confirm that you inspected the completed listing and exact edition."); return; }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/add-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...commonPayload(),
          action: "approve",
          soldDate,
          salePrice,
          shippingPrice,
          currency,
          quantity,
          saleType,
          priceCorroborationUrl,
          isGraded,
          gradingCompany,
          gradeLabel,
          printClassification,
          printingProofUrl,
          knownPrintingNumber,
          humanConfirmed,
        }),
      });
      const data = await response.json() as { observationId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The approved listing could not be saved.");
      setMessage("Approved sale added as verified market evidence. No second review is required.");
      clearSale();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The approved listing could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  async function rejectCandidate() {
    if (!selectedEdition || !reviewer.trim() || !rejectionReason) {
      setMessage("Choose the edition, identify the reviewer, and select a rejection reason.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/add-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...commonPayload(), action: "reject", rejectionReason }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The rejection could not be recorded.");
      setMessage("Candidate rejected and saved as human feedback for RAR's controlled learning.");
      clearSale();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The rejection could not be recorded.");
    } finally {
      setLoading(false);
    }
  }

  return <form className="quick-sale-form approved-listing-form" onSubmit={submit}>
    <section className="approved-listing-reviewer">
      <div><p className="eyebrow">One human decision</p><strong>Who is approving this listing?</strong><small>Your name is remembered for this browser session and stamped on every audit record.</small></div>
      <label>Your name / initials<input required value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="SP" /></label>
    </section>

    <div className="quick-sale-step"><span>1</span><div><strong>Select the exact RAR edition</strong><p>The listing will become verified evidence for this record immediately after your confirmation.</p></div></div>
    <div className="price-import-field">
      {selectedEdition ? <div className="selected-edition"><strong>{editionLabel(selectedEdition)}</strong><button type="button" onClick={resetEdition}>Change edition</button></div> : <>
        <label htmlFor="quick-sale-edition">Search a verified RAR edition</label>
        <input id="quick-sale-edition" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing a title or series" autoComplete="off" />
        {visibleSuggestions.length ? <div className="edition-suggestions">{visibleSuggestions.map((edition) => <button type="button" key={edition.id} onClick={() => selectEdition(edition)}>{editionLabel(edition)}</button>)}</div> : null}
      </>}
    </div>

    {selectedEdition ? <>
      <div className="quick-sale-step"><span>2</span><div><strong>Bring the evidence into RAR</strong><p>Paste or enter what you can already see. RAR does not revisit or fetch the marketplace page.</p></div></div>
      <div className="quick-sale-grid">
        <label className="quick-sale-wide">Pasted completed-listing details <small>Optional helper. Labelled lines such as Title, Sold price, Sold date, Postage and URL work best.</small><textarea value={submittedText} onChange={(event) => setSubmittedText(event.target.value)} placeholder={'Title: Hunter × Hunter Vol. 1 Japanese Manga BGS 9.0\nSold price: £166.84\nSold date: 2026-08-30\nPostage: £5.00\nURL: https://www.ebay.co.uk/itm/...'} rows={7} /></label>
        <div className="quick-sale-wide submitted-evidence-action"><button type="button" onClick={usePastedEvidence}>Fill from pasted evidence</button><p>The parser only reads what you paste here. It makes no eBay request.</p></div>
        <label>Marketplace source<select required value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name ?? "Unnamed marketplace"}</option>)}</select></label>
        <label>Marketplace listing ID<input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Read from eBay URL when possible" /></label>
        <label className="quick-sale-wide">Original completed-listing link<input required type="url" value={sourceListingUrl} onChange={(event) => changeListingUrl(event.target.value)} placeholder="https://..." /></label>
        <label className="quick-sale-wide">Listing title<input required value={listingTitle} onChange={(event) => setListingTitle(event.target.value)} onBlur={applyTitleSignals} placeholder="Copy the title exactly as shown" /></label>
      </div>

      <aside className={`sale-signal-summary${liveDetection.bestOffer ? " needs-attention" : ""}`}>
        <strong>RAR&apos;s automatic checks</strong>
        <span>{liveDetection.grading.isGraded ? `Graded wording detected${liveDetection.grading.company ? `: ${liveDetection.grading.company}` : ""}${liveDetection.grading.grade ? ` ${liveDetection.grading.grade}` : ""}.` : "No graded wording detected."}</span>
        <span>{liveDetection.bestOffer ? "Best Offer wording detected — confirm the actual paid price below." : "No Best Offer wording detected."}</span>
        <small>These are suggestions only. Your confirmed fields become the evidence, and any correction is retained for agent learning.</small>
      </aside>

      <div className="quick-sale-step"><span>3</span><div><strong>Confirm what actually sold</strong><p>RAR charts use the item price only. Delivery is stored separately and never added to market value.</p></div></div>
      <div className="quick-sale-grid">
        <label>Sold date<input required type="date" value={soldDate} onChange={(event) => setSoldDate(event.target.value)} /></label>
        <label>Sale type<select value={saleType} onChange={(event) => setSaleType(event.target.value as SaleType)}><option value="unknown">Unknown</option><option value="auction">Auction</option><option value="fixed_price">Fixed price</option><option value="best_offer">Best Offer accepted</option></select></label>
        <label>Actual item price <small>Exclude postage/delivery</small><input required inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="0.00" /></label>
        <label>Currency<input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="GBP" /></label>
        <label>Postage / delivery <small>Stored separately; blank is allowed</small><input inputMode="decimal" value={shippingPrice} onChange={(event) => setShippingPrice(event.target.value)} placeholder="0.00" /></label>
        <label>Copies reported sold <small>One listing remains one chart point</small><input required min={1} type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        {saleType === "best_offer" ? <label className="quick-sale-wide best-offer-proof">Actual-price corroboration link <small>Required because eBay&apos;s displayed price may not be what the buyer paid. A 130point result is acceptable.</small><input required type="url" value={priceCorroborationUrl} onChange={(event) => setPriceCorroborationUrl(event.target.value)} placeholder="https://..." /></label> : null}
      </div>

      <div className="quick-sale-step"><span>4</span><div><strong>Confirm grading and printing</strong><p>Every company and grade gets its own comparison group. Printing remains separate too.</p></div></div>
      <div className="quick-sale-grid">
        <label>Copy type<select value={isGraded ? "graded" : "raw"} onChange={(event) => setIsGraded(event.target.value === "graded")}><option value="raw">Raw / ungraded</option><option value="graded">Graded</option></select></label>
        <label>Print classification<select value={printClassification} onChange={(event) => setPrintClassification(event.target.value as PrintClassification)}><option value="printing_not_identified">Printing not identified</option><option value="known_later_print">Known later printing</option><option value="first_print_proven">First print — proven</option></select></label>
        {isGraded ? <><label>Grading company<input required value={gradingCompany} onChange={(event) => setGradingCompany(event.target.value.toUpperCase())} placeholder="BGS, CGC, PSA..." /></label><label>Exact grade<input required value={gradeLabel} onChange={(event) => setGradeLabel(event.target.value)} placeholder="9.0" /></label></> : null}
        <label>Known printing number <small>Optional</small><input inputMode="numeric" min={1} type="number" value={knownPrintingNumber} onChange={(event) => setKnownPrintingNumber(event.target.value)} placeholder="e.g. 1" /></label>
        <label className="quick-sale-wide">Copyright-page proof link <small>Required only for a proven first print. It must show the printing evidence for this sold copy.</small><input required={printClassification === "first_print_proven"} type="url" value={printingProofUrl} onChange={(event) => setPrintingProofUrl(event.target.value)} placeholder="https://..." /></label>
        <label className="quick-sale-wide">Optional note<textarea value={intakeNotes} onChange={(event) => setIntakeNotes(event.target.value)} placeholder="Only add context when something needs explaining." rows={3} /></label>
      </div>

      <label className="quick-sale-verify approved-listing-confirmation">
        <input checked={humanConfirmed} onChange={(event) => setHumanConfirmed(event.target.checked)} type="checkbox" />
        <span><strong>I inspected this completed sale and confirmed the exact RAR edition</strong><small>This single confirmation creates the verified sale, printing decision and permanent audit history. There is no second review queue.</small></span>
      </label>
      <div className="quick-sale-submit approved-listing-submit"><button type="submit" disabled={loading || !humanConfirmed}>{loading ? "Saving decision..." : "Approve listing and add verified sale"}</button><p>One inspection, one confirmation, one finished record.</p></div>

      <details className="reject-submitted-listing">
        <summary>Not suitable? Record a rejection for agent learning</summary>
        <div><label>Reason<select value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)}><option value="">Choose reason</option><option value="wrong_edition">Wrong edition or volume</option><option value="not_completed">Not a completed sale</option><option value="best_offer_unconfirmed">Best Offer price unconfirmed</option><option value="multi_volume_lot">Multi-volume lot</option><option value="duplicate_listing">Already recorded</option><option value="insufficient_evidence">Not enough evidence</option><option value="other">Other</option></select></label><button type="button" disabled={loading || !rejectionReason} onClick={rejectCandidate}>Record rejection</button></div>
      </details>
    </> : null}
    {message ? <p className="quick-sale-message" role="status">{message}</p> : null}
  </form>;
}
