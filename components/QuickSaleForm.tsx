"use client";
/* eslint-disable @next/next/no-img-element -- staff-only eBay evidence URLs are arbitrary and short-lived */

import { useEffect, useMemo, useRef, useState } from "react";
import { extractEbayLegacyItemId } from "@/lib/ebayEvidence";
import { detectGrading, detectsBestOffer, parseSubmittedSaleText } from "@/lib/submittedSale";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

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
type EbayEvidence = {
  itemId: string;
  state: string;
  title: string;
  imageUrls: string[];
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  shippingPrice: number | null;
  quantitySold: number | null;
  buyingFormat: string | null;
  bestOffer: boolean;
  detail: string;
};

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
  const [reviewer, setReviewer] = useStaffReviewer();
  const [rejectionReason, setRejectionReason] = useState("");
  const [evidenceImages, setEvidenceImages] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const initialEditionLoaded = useRef(false);

  const visibleSuggestions = query.trim().length >= 2 && !selectedEdition ? suggestions : [];
  const liveDetection = useMemo(() => {
    const text = `${listingTitle}\n${submittedText}`;
    return { grading: detectGrading(text), bestOffer: detectsBestOffer(text) };
  }, [listingTitle, submittedText]);

  useEffect(() => {
    if (!initialEditionId || initialEditionLoaded.current) return;
    initialEditionLoaded.current = true;
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
  }, [initialEditionId]);

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

  async function fillFromEbay() {
    if (!sourceListingUrl.trim()) {
      setMessage("Paste the eBay sold-listing link first.");
      return;
    }
    setLookupLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/add-sale?listingUrl=${encodeURIComponent(sourceListingUrl.trim())}`);
      const data = await response.json() as { evidence?: EbayEvidence; error?: string };
      if (!response.ok || !data.evidence) throw new Error(data.error ?? "eBay could not load this listing.");
      const evidence = data.evidence;
      setExternalId(evidence.itemId);
      setListingTitle(evidence.title);
      setSoldDate(evidence.soldAt?.slice(0, 10) ?? "");
      setSalePrice(evidence.soldPrice === null ? "" : String(evidence.soldPrice));
      setCurrency(evidence.soldCurrency?.toUpperCase() ?? "GBP");
      setShippingPrice(evidence.shippingPrice === null ? "" : String(evidence.shippingPrice));
      setQuantity(evidence.quantitySold && evidence.quantitySold > 0 ? String(evidence.quantitySold) : "1");
      setEvidenceImages(evidence.imageUrls);
      const format = (evidence.buyingFormat ?? "").toUpperCase();
      setSaleType(evidence.bestOffer ? "best_offer" : format.includes("AUCTION") ? "auction" : format ? "fixed_price" : "unknown");
      const grading = detectGrading(evidence.title);
      setIsGraded(grading.isGraded);
      setGradingCompany(grading.company ?? "");
      setGradeLabel(grading.grade ?? "");
      const ebaySource = sources.find((source) => source.name === "eBay Sold");
      if (ebaySource) setSourceId(ebaySource.id);
      setMessage(evidence.bestOffer
        ? "eBay confirmed the sale and filled the listing. Add the accepted price and its 130point link, then approve."
        : "eBay confirmed the sale and filled the available details. Check the printing choice, then approve once.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "eBay could not load this listing.");
    } finally {
      setLookupLoading(false);
    }
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
    setRejectionReason("");
    setEvidenceImages([]);
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
          humanConfirmed: true,
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
      <div className="quick-sale-step"><span>2</span><div><strong>Paste the eBay sold-listing link</strong><p>RAR makes one targeted eBay request and fills everything the marketplace exposes.</p></div></div>
      <div className="quick-sale-grid">
        <label className="quick-sale-wide">eBay sold-listing link<input required type="url" value={sourceListingUrl} onChange={(event) => changeListingUrl(event.target.value)} placeholder="https://www.ebay.co.uk/itm/..." /></label>
        <div className="quick-sale-wide submitted-evidence-action"><button type="button" disabled={lookupLoading} onClick={fillFromEbay}>{lookupLoading ? "Reading eBay..." : "Fill details from eBay"}</button><p>One request for this listing only. No background item-page scraping.</p></div>
        {evidenceImages.length ? <div className="quick-sale-wide ebay-evidence-images"><strong>Listing photos</strong><div>{evidenceImages.slice(0, 12).map((imageUrl) => <button className={printingProofUrl === imageUrl ? "selected" : ""} type="button" key={imageUrl} onClick={() => setPrintingProofUrl(imageUrl)} title="Use this as printing proof"><img src={imageUrl} alt="eBay listing evidence" /><span>{printingProofUrl === imageUrl ? "Selected as proof" : "Use as print proof"}</span></button>)}</div></div> : null}
        <label>Marketplace source<select required value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name ?? "Unnamed marketplace"}</option>)}</select></label>
        <label>Marketplace listing ID<input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Read from eBay URL when possible" /></label>
        <label className="quick-sale-wide">Listing title<input required value={listingTitle} onChange={(event) => setListingTitle(event.target.value)} onBlur={applyTitleSignals} placeholder="Copy the title exactly as shown" /></label>
      </div>

      <details className="manual-sale-fallback">
        <summary>eBay could not supply something? Paste visible details instead</summary>
        <label>Pasted completed-listing details<textarea value={submittedText} onChange={(event) => setSubmittedText(event.target.value)} placeholder={'Title: Hunter × Hunter Vol. 1 Japanese Manga BGS 9.0\nSold price: £166.84\nSold date: 2026-08-30\nPostage: £5.00'} rows={6} /></label>
        <button type="button" onClick={usePastedEvidence}>Fill from pasted evidence</button>
      </details>

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

      <div className="quick-sale-submit approved-listing-submit"><button type="submit" disabled={loading}>{loading ? "Saving decision..." : "Approve listing and add verified sale"}</button><p>This button is the confirmation. It creates the verified sale, printing decision and audit record in one step.</p></div>

      <details className="reject-submitted-listing">
        <summary>Not suitable? Record a rejection for agent learning</summary>
        <div><label>Reason<select value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)}><option value="">Choose reason</option><option value="wrong_edition">Wrong edition or volume</option><option value="not_completed">Not a completed sale</option><option value="best_offer_unconfirmed">Best Offer price unconfirmed</option><option value="multi_volume_lot">Multi-volume lot</option><option value="duplicate_listing">Already recorded</option><option value="insufficient_evidence">Not enough evidence</option><option value="other">Other</option></select></label><button type="button" disabled={loading || !rejectionReason} onClick={rejectCandidate}>Record rejection</button></div>
      </details>
    </> : null}
    {message ? <p className="quick-sale-message" role="status">{message}</p> : null}
  </form>;
}
