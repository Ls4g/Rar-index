"use client";

import { useEffect, useMemo, useState } from "react";
import { detectGrading, parseSubmittedSaleLinks } from "@/lib/submittedSale";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

type Edition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
};
type Source = { id: string; name: string | null };
type PrintClassification = "printing_not_identified" | "known_later_print" | "first_print_proven";
type SaleType = "unknown" | "auction" | "fixed_price" | "best_offer";
type EbayEvidence = {
  itemId: string;
  state: string;
  title: string;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  shippingPrice: number | null;
  quantitySold: number | null;
  buyingFormat: string | null;
  bestOffer: boolean;
  detail: string;
};
type LookupResult = { listingUrl: string; itemId?: string; evidence?: EbayEvidence; error?: string };
type BatchRow = {
  key: string;
  listingUrl: string;
  externalId: string;
  listingTitle: string;
  soldDate: string;
  salePrice: string;
  shippingPrice: string;
  currency: string;
  quantity: string;
  saleType: SaleType;
  priceCorroborationUrl: string;
  isGraded: boolean;
  gradingCompany: string;
  gradeLabel: string;
  printClassification: PrintClassification;
  printingProofUrl: string;
  knownPrintingNumber: string;
  intakeNotes: string;
  lookupWarning: string;
  status: "draft" | "saving" | "saved" | "failed";
  resultMessage: string;
};

function editionLabel(edition: Edition) {
  return [edition.title, edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.publisher]
    .filter(Boolean).join(" · ");
}

function rowFromLookup(result: LookupResult): BatchRow {
  const evidence = result.evidence;
  const format = (evidence?.buyingFormat ?? "").toUpperCase();
  const grading = detectGrading(evidence?.title ?? "");
  return {
    key: evidence?.itemId || result.itemId || result.listingUrl,
    listingUrl: result.listingUrl,
    externalId: evidence?.itemId || result.itemId || "",
    listingTitle: evidence?.title ?? "",
    soldDate: evidence?.soldAt?.slice(0, 10) ?? "",
    salePrice: evidence?.soldPrice === null || evidence?.soldPrice === undefined ? "" : String(evidence.soldPrice),
    shippingPrice: evidence?.shippingPrice === null || evidence?.shippingPrice === undefined ? "" : String(evidence.shippingPrice),
    currency: evidence?.soldCurrency?.toUpperCase() ?? "GBP",
    quantity: evidence?.quantitySold && evidence.quantitySold > 0 ? String(evidence.quantitySold) : "1",
    saleType: evidence?.bestOffer ? "best_offer" : format.includes("AUCTION") ? "auction" : format ? "fixed_price" : "unknown",
    priceCorroborationUrl: "",
    isGraded: grading.isGraded,
    gradingCompany: grading.company,
    gradeLabel: grading.grade,
    printClassification: "printing_not_identified",
    printingProofUrl: "",
    knownPrintingNumber: "",
    intakeNotes: "",
    lookupWarning: result.error ?? "",
    status: "draft",
    resultMessage: "",
  };
}

function rowIsReady(row: BatchRow) {
  if (!row.listingUrl || !row.externalId || !row.listingTitle || !row.soldDate || !row.salePrice || !/^[A-Z]{3}$/.test(row.currency)) return false;
  if (row.isGraded && (!row.gradingCompany || !row.gradeLabel)) return false;
  if (row.saleType === "best_offer" && !row.priceCorroborationUrl) return false;
  if (row.printClassification === "first_print_proven" && !row.printingProofUrl) return false;
  return row.status !== "saved";
}

export default function BulkApprovedSalesForm({ initialEditionId = "" }: { initialEditionId?: string }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Edition[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [reviewer, setReviewer] = useStaffReviewer();
  const [pastedLinks, setPastedLinks] = useState("");
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [message, setMessage] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const visibleSuggestions = query.trim().length >= 2 && !selectedEdition ? suggestions : [];
  const pastedLinkCount = useMemo(() => parseSubmittedSaleLinks(pastedLinks).length, [pastedLinks]);
  const readyCount = useMemo(() => rows.filter(rowIsReady).length, [rows]);
  const savedCount = rows.filter((row) => row.status === "saved").length;

  useEffect(() => {
    if (!initialEditionId || selectedEdition) return;
    const controller = new AbortController();
    fetch(`/api/add-sale?editionId=${encodeURIComponent(initialEditionId)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { edition?: Edition; sources?: Source[]; error?: string };
        if (!response.ok || !data.edition) throw new Error(data.error ?? "The selected edition could not be loaded.");
        setSelectedEdition(data.edition);
        setSourceId(data.sources?.find((source) => source.name === "eBay Sold")?.id ?? "");
      })
      .catch((error) => { if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "The edition could not be loaded."); });
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
        setSourceId((current) => current || data.sources?.find((source) => source.name === "eBay Sold")?.id || "");
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Edition suggestions could not be loaded.");
      }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectedEdition]);

  function updateRow(key: string, values: Partial<BatchRow>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...values, status: row.status === "saved" ? "saved" : "draft", resultMessage: "" } : row));
  }

  async function prepareBatch() {
    const listingUrls = parseSubmittedSaleLinks(pastedLinks);
    if (!selectedEdition) { setMessage("Choose the exact RAR edition for this batch first."); return; }
    if (!listingUrls.length) { setMessage("Paste at least one eBay item link."); return; }
    if (listingUrls.length > 25) { setMessage("Use no more than 25 unique links in one batch."); return; }
    setPreparing(true);
    setMessage("");
    try {
      const response = await fetch("/api/add-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "lookup_batch", listingUrls }),
      });
      const data = await response.json() as { results?: LookupResult[]; error?: string };
      if (!response.ok || !data.results) throw new Error(data.error ?? "The batch could not be prepared.");
      setRows(data.results.map(rowFromLookup));
      const blocked = data.results.filter((result) => result.error).length;
      setMessage(blocked
        ? `Prepared ${data.results.length} links. ${blocked} need visible details because eBay could not confirm them automatically.`
        : `Prepared ${data.results.length} completed sales. Check the printing and grading choices, then publish them together.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The batch could not be prepared.");
    } finally {
      setPreparing(false);
    }
  }

  function applyPrintToDraftRows(value: PrintClassification) {
    setRows((current) => current.map((row) => row.status === "saved" ? row : { ...row, printClassification: value }));
  }

  async function publishBatch() {
    if (!selectedEdition || !sourceId || !reviewer.trim()) { setMessage("Choose the edition and enter the reviewer before publishing."); return; }
    const readyRows = rows.filter(rowIsReady);
    if (!readyRows.length) { setMessage("No rows are ready. Complete the highlighted missing fields first."); return; }
    setPublishing(true);
    setMessage("");
    let added = 0;
    let failed = 0;
    for (let index = 0; index < readyRows.length; index += 3) {
      const chunk = readyRows.slice(index, index + 3);
      setRows((current) => current.map((row) => chunk.some((entry) => entry.key === row.key) ? { ...row, status: "saving" } : row));
      const results = await Promise.all(chunk.map(async (row) => {
        try {
          const response = await fetch("/api/add-sale", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "approve", humanConfirmed: true, editionId: selectedEdition.id, sourceId, reviewer,
              submittedText: "", sourceListingUrl: row.listingUrl, externalId: row.externalId,
              listingTitle: row.listingTitle, soldDate: row.soldDate, salePrice: row.salePrice,
              shippingPrice: row.shippingPrice, currency: row.currency, quantity: row.quantity,
              saleType: row.saleType, priceCorroborationUrl: row.priceCorroborationUrl,
              isGraded: row.isGraded, gradingCompany: row.gradingCompany, gradeLabel: row.gradeLabel,
              printClassification: row.printClassification, printingProofUrl: row.printingProofUrl,
              knownPrintingNumber: row.knownPrintingNumber, intakeNotes: row.intakeNotes,
            }),
          });
          const data = await response.json() as { error?: string };
          if (!response.ok) throw new Error(data.error ?? "Sale could not be saved.");
          return { key: row.key, status: "saved" as const, message: "Published as verified evidence." };
        } catch (error) {
          return { key: row.key, status: "failed" as const, message: error instanceof Error ? error.message : "Sale could not be saved." };
        }
      }));
      added += results.filter((result) => result.status === "saved").length;
      failed += results.filter((result) => result.status === "failed").length;
      setRows((current) => current.map((row) => {
        const result = results.find((entry) => entry.key === row.key);
        return result ? { ...row, status: result.status, resultMessage: result.message } : row;
      }));
    }
    setPublishing(false);
    setMessage(`${added} sale${added === 1 ? "" : "s"} published${failed ? `; ${failed} need attention` : ""}. Every successful row is already verified—there is no second queue.`);
  }

  return <section className="bulk-approved-sales" aria-labelledby="bulk-approved-sales-heading">
    <div className="bulk-sale-heading">
      <div><p className="eyebrow">Fast lane</p><h2 id="bulk-approved-sales-heading">Bulk approved sales</h2><p>Choose one exact edition, paste up to 25 sold links, then approve every ready sale in one action.</p></div>
      {rows.length ? <strong>{savedCount}/{rows.length} published</strong> : null}
    </div>

    <section className="approved-listing-reviewer">
      <div><strong>Reviewer</strong><small>This is your human approval. It is written to every sale and audit record.</small></div>
      <label>Name / initials<input required value={reviewer} onChange={(event) => setReviewer(event.target.value)} placeholder="SP" /></label>
    </section>

    <div className="bulk-sale-edition">
      <span>1</span><div><strong>Which exact edition do all these links belong to?</strong>
      {selectedEdition ? <div className="selected-edition"><strong>{editionLabel(selectedEdition)}</strong><button type="button" onClick={() => { setSelectedEdition(null); setRows([]); setQuery(""); }}>Change edition</button></div> : <>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title or series" autoComplete="off" />
        {visibleSuggestions.length ? <div className="edition-suggestions">{visibleSuggestions.map((edition) => <button type="button" key={edition.id} onClick={() => { setSelectedEdition(edition); setSuggestions([]); }}>{editionLabel(edition)}</button>)}</div> : null}
      </>}</div>
    </div>

    <div className="bulk-sale-links">
      <span>2</span><label><strong>Paste eBay sold-listing links</strong><small>One per line. Best Offer links are accepted only when you add the true price and 130point corroboration below.</small><textarea value={pastedLinks} onChange={(event) => setPastedLinks(event.target.value)} rows={6} placeholder={'https://www.ebay.co.uk/itm/123456789012\nhttps://www.ebay.com/itm/987654321098'} /></label>
      <button type="button" disabled={preparing || !selectedEdition || pastedLinkCount === 0} onClick={prepareBatch}>{preparing ? "Reading links…" : pastedLinkCount ? `Prepare ${pastedLinkCount} link${pastedLinkCount === 1 ? "" : "s"}` : "Paste links to begin"}</button>
    </div>

    {rows.length ? <>
      <div className="bulk-sale-toolbar"><div><strong>3. Check only what needs attention</strong><span>RAR has filled the available eBay facts.</span></div><label>Apply printing to all unpublished<select defaultValue="" onChange={(event) => { if (event.target.value) applyPrintToDraftRows(event.target.value as PrintClassification); }}><option value="">Choose…</option><option value="printing_not_identified">Printing not identified</option><option value="known_later_print">Known later printing</option><option value="first_print_proven">First print — proven</option></select></label></div>
      <div className="bulk-sale-rows">{rows.map((row, rowIndex) => {
        const ready = rowIsReady(row);
        const stateClass = row.status === "saved" ? "saved" : row.status === "failed" ? "failed" : ready ? "ready" : "needs-input";
        return <article className={`bulk-sale-row ${stateClass}`} key={row.key}>
          <header><span>{rowIndex + 1}</span><div><strong>{row.listingTitle || "Listing details needed"}</strong><a href={row.listingUrl} target="_blank" rel="noreferrer">Open source ↗</a></div><em>{row.status === "saved" ? "Published" : ready ? "Ready" : "Needs input"}</em></header>
          {row.lookupWarning ? <p className="bulk-sale-warning">eBay lookup: {row.lookupWarning} You can still enter the facts you personally verified.</p> : null}
          <div className="bulk-sale-fields">
            <label className="wide">Listing title<input value={row.listingTitle} onChange={(event) => updateRow(row.key, { listingTitle: event.target.value })} /></label>
            <label>Sold date<input type="date" value={row.soldDate} onChange={(event) => updateRow(row.key, { soldDate: event.target.value })} /></label>
            <label>Item price<input inputMode="decimal" value={row.salePrice} onChange={(event) => updateRow(row.key, { salePrice: event.target.value })} /></label>
            <label>Currency<input maxLength={3} value={row.currency} onChange={(event) => updateRow(row.key, { currency: event.target.value.toUpperCase() })} /></label>
            <label>Sale type<select value={row.saleType} onChange={(event) => updateRow(row.key, { saleType: event.target.value as SaleType })}><option value="unknown">Unknown</option><option value="auction">Auction</option><option value="fixed_price">Fixed price</option><option value="best_offer">Best Offer</option></select></label>
            <label>Print<select value={row.printClassification} onChange={(event) => updateRow(row.key, { printClassification: event.target.value as PrintClassification })}><option value="printing_not_identified">Not identified</option><option value="known_later_print">Later print</option><option value="first_print_proven">First print — proven</option></select></label>
            <label>Copy type<select value={row.isGraded ? "graded" : "raw"} onChange={(event) => updateRow(row.key, { isGraded: event.target.value === "graded" })}><option value="raw">Raw</option><option value="graded">Graded</option></select></label>
            {row.isGraded ? <><label>Grader<input value={row.gradingCompany} onChange={(event) => updateRow(row.key, { gradingCompany: event.target.value.toUpperCase() })} /></label><label>Grade<input value={row.gradeLabel} onChange={(event) => updateRow(row.key, { gradeLabel: event.target.value })} /></label></> : null}
            {row.saleType === "best_offer" ? <label className="wide attention">130point corroboration link<input type="url" value={row.priceCorroborationUrl} onChange={(event) => updateRow(row.key, { priceCorroborationUrl: event.target.value })} placeholder="Required for the true accepted price" /></label> : null}
            {row.printClassification === "first_print_proven" ? <label className="wide attention">Copyright-page proof link<input type="url" value={row.printingProofUrl} onChange={(event) => updateRow(row.key, { printingProofUrl: event.target.value })} placeholder="Required for this sold copy" /></label> : null}
          </div>
          <details><summary>Optional delivery, quantity and notes</summary><div className="bulk-sale-fields"><label>Delivery<input inputMode="decimal" value={row.shippingPrice} onChange={(event) => updateRow(row.key, { shippingPrice: event.target.value })} /></label><label>Quantity<input min={1} type="number" value={row.quantity} onChange={(event) => updateRow(row.key, { quantity: event.target.value })} /></label><label className="wide">Note<textarea rows={2} value={row.intakeNotes} onChange={(event) => updateRow(row.key, { intakeNotes: event.target.value })} /></label></div></details>
          {row.resultMessage ? <p className="bulk-sale-result">{row.resultMessage}</p> : null}
        </article>;
      })}</div>
      <div className="bulk-sale-publish"><button type="button" disabled={publishing || readyCount === 0} onClick={publishBatch}>{publishing ? "Publishing ready sales…" : `Approve and publish ${readyCount} ready sale${readyCount === 1 ? "" : "s"}`}</button><p>Successful rows go straight to verified evidence with individual duplicate protection and audit records.</p></div>
    </> : null}
    {message ? <p className="quick-sale-message" role="status">{message}</p> : null}
  </section>;
}
