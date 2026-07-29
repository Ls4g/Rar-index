"use client";

import { ChangeEvent, useEffect, useState } from "react";
import Link from "next/link";

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

type ReportRow = {
  rowNumber: number;
  status: "ready" | "duplicate" | "blocked";
  issues: string[];
  source: string;
  externalId: string;
  listingTitle: string;
  soldDate: string;
  price: string;
  currency: string;
  evidenceImageUrl: string;
  match: { score: number; confidence: "strong" | "partial" | "insufficient" | "conflict"; reasons: string[]; conflicts: string[] } | null;
};

type Preflight = {
  edition: Edition;
  totalRows: number;
  readyCount: number;
  duplicateCount: number;
  blockedCount: number;
  rows: ReportRow[];
  committed?: number;
};

type CollectionRun = {
  id: string;
  checked_at: string;
  checked_by: string;
  candidate_count: number;
  notes: string;
};

type MarketplaceSource = { id: string; name: string | null; base_url: string | null };
type CommunityReportHandoff = {
  id: string;
  sourceListingUrl: string;
  listingTitle: string | null;
  reportedPrice: number | null;
  currency: string | null;
  soldDate: string | null;
  reporterNotes: string;
  externalId: string | null;
  edition: Edition & { publisher: string | null; format: string | null };
};

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

function collectionRunLabel(run: CollectionRun) {
  const checkedAt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(run.checked_at));
  return `${checkedAt} · ${run.checked_by} · ${run.candidate_count} candidates`;
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export default function PriceImportForm({ communityReportId = "" }: { communityReportId?: string }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Edition[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [collectionRuns, setCollectionRuns] = useState<CollectionRun[]>([]);
  const [selectedCollectionRunId, setSelectedCollectionRunId] = useState("");
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Preflight | null>(null);
  const [message, setMessage] = useState("");
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingCollectionRuns, setLoadingCollectionRuns] = useState(false);
  const [working, setWorking] = useState(false);
  const visibleSuggestions = !selectedEdition && query.trim().length >= 2 ? suggestions : [];
  const [communityReport, setCommunityReport] = useState<CommunityReportHandoff | null>(null);
  const [communitySources, setCommunitySources] = useState<MarketplaceSource[]>([]);
  const [handoffSourceId, setHandoffSourceId] = useState("");
  const [handoffExternalId, setHandoffExternalId] = useState("");
  const [handoffSaleType, setHandoffSaleType] = useState("unknown");
  const [handoffPrice, setHandoffPrice] = useState("");
  const [handoffCurrency, setHandoffCurrency] = useState("");
  const [handoffSoldDate, setHandoffSoldDate] = useState("");
  const [handoffLoading, setHandoffLoading] = useState(Boolean(communityReportId));

  useEffect(() => {
    if (query.trim().length < 2 || selectedEdition) return;

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const response = await fetch(`/api/price-import?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
        const data = (await response.json()) as { editions?: Edition[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Edition suggestions could not be loaded.");
        setSuggestions(data.editions ?? []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Edition suggestions could not be loaded.");
      } finally {
        setLoadingSuggestions(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, selectedEdition]);

  useEffect(() => {
    if (!selectedEdition) return;

    const controller = new AbortController();
    fetch(`/api/collection-runs?editionId=${encodeURIComponent(selectedEdition.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { runs?: CollectionRun[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Collection runs could not be loaded.");
        setCollectionRuns(data.runs ?? []);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Collection runs could not be loaded.");
      })
      .finally(() => setLoadingCollectionRuns(false));

    return () => controller.abort();
  }, [selectedEdition]);

  useEffect(() => {
    if (!communityReportId) return;
    const controller = new AbortController();
    fetch(`/api/community-reports?id=${encodeURIComponent(communityReportId)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as { report?: CommunityReportHandoff; sources?: MarketplaceSource[]; suggestedSourceId?: string | null; error?: string };
        if (!response.ok || !data.report) throw new Error(data.error ?? "The community report handoff could not be loaded.");
        setCommunityReport(data.report);
        setCommunitySources(data.sources ?? []);
        setHandoffSourceId(data.suggestedSourceId ?? "");
        setHandoffExternalId(data.report.externalId ?? "");
        setHandoffPrice(data.report.reportedPrice?.toString() ?? "");
        setHandoffCurrency(data.report.currency ?? "");
        setHandoffSoldDate(data.report.soldDate ?? "");
        setSelectedEdition(data.report.edition);
        setCollectionRuns([]);
        setSelectedCollectionRunId("");
        setLoadingCollectionRuns(true);
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "The community report handoff could not be loaded.");
      })
      .finally(() => setHandoffLoading(false));
    return () => controller.abort();
  }, [communityReportId]);

  function selectEdition(edition: Edition) {
    setSelectedEdition(edition);
    setSuggestions([]);
    setCollectionRuns([]);
    setSelectedCollectionRunId("");
    setLoadingCollectionRuns(true);
    setResult(null);
  }

  function clearSelectedEdition() {
    setSelectedEdition(null);
    setQuery("");
    setSuggestions([]);
    setCollectionRuns([]);
    setSelectedCollectionRunId("");
    setLoadingCollectionRuns(false);
    setResult(null);
  }

  function generateCommunityReportCsv() {
    if (!communityReport) return;
    const source = communitySources.find((item) => item.id === handoffSourceId);
    if (!source || !handoffExternalId.trim()) {
      setMessage("Choose the marketplace source and add its external listing ID before creating the handoff CSV.");
      return;
    }
    const headers = [
      "source_id", "external_id", "source_listing_url", "listing_title", "sale_status", "sale_type", "sold_date", "sale_price", "currency", "shipping_price", "evidence_image_url", "raw_payload", "candidate_title", "candidate_series", "candidate_volume_number", "candidate_language", "candidate_isbn_13", "candidate_publisher", "candidate_format",
    ];
    const payload = {
      source: "community_report",
      community_report_id: communityReport.id,
      reporter_notes: communityReport.reporterNotes,
      reported_values: { price: handoffPrice || null, currency: handoffCurrency || null, sold_date: handoffSoldDate || null },
      handoff_created_at: new Date().toISOString(),
    };
    const row = [
      source.id, handoffExternalId.trim(), communityReport.sourceListingUrl, communityReport.listingTitle ?? "", "confirmed", handoffSaleType, handoffSoldDate, handoffPrice, handoffCurrency.toUpperCase(), "", "", JSON.stringify(payload), communityReport.edition.title ?? "", communityReport.edition.series ?? "", communityReport.edition.volume_number ?? "", communityReport.edition.language ?? "", communityReport.edition.isbn_13 ?? "", communityReport.edition.publisher ?? "", communityReport.edition.format ?? "",
    ];
    setCsv(`${headers.join(",")}\n${row.map(csvCell).join(",")}`);
    setResult(null);
    setMessage(`Prepared one ${source.name ?? "marketplace"} row from the community report. Choose its recorded collection run, then run preflight.`);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
    setResult(null);
    setMessage(`Loaded ${file.name}. Run preflight before queuing anything.`);
  }

  async function runImport(dryRun: boolean) {
    if (!selectedEdition) {
      setMessage("Select the exact verified RAR edition first.");
      return;
    }
    if (!selectedCollectionRunId) {
      setMessage("Record or choose the collection run that found this batch first.");
      return;
    }
    if (!csv.trim()) {
      setMessage("Paste a CSV or choose a .csv file first.");
      return;
    }

    setWorking(true);
    setMessage("");
    try {
      const response = await fetch("/api/price-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editionId: selectedEdition.id, collectionRunId: selectedCollectionRunId, csv, dryRun }),
      });
      const data = (await response.json()) as Preflight & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "The CSV could not be processed.");
      setResult(data);
      setMessage(dryRun
        ? "Preflight complete. Nothing has been added to RAR yet."
        : `${data.committed ?? 0} safe sale${data.committed === 1 ? "" : "s"} queued for staff review; none were verified automatically.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The CSV could not be processed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="price-import-shell">
      {communityReportId ? (
        <section className="community-handoff" aria-live="polite">
          <p className="eyebrow">Community report handoff</p>
          {handoffLoading ? <p>Loading the approved report…</p> : communityReport ? <>
            <h3>{communityReport.listingTitle ?? "Reported sale"}</h3>
            <p>RAR has not accepted this as a sale. Confirm the marketplace source and listing ID, then create a CSV row for normal preflight.</p>
            <div className="community-handoff-fields">
              <label>Marketplace source<select value={handoffSourceId} onChange={(event) => setHandoffSourceId(event.target.value)}><option value="">Choose source</option>{communitySources.map((source) => <option key={source.id} value={source.id}>{source.name ?? "Unnamed source"}</option>)}</select></label>
              <label>External listing ID<input value={handoffExternalId} onChange={(event) => setHandoffExternalId(event.target.value)} placeholder="Marketplace item ID" /></label>
              <label>Sale type<select value={handoffSaleType} onChange={(event) => setHandoffSaleType(event.target.value)}><option value="unknown">Unknown</option><option value="auction">Auction</option><option value="best_offer">Best offer</option><option value="fixed_price">Fixed price</option></select></label>
              <label>Price<input inputMode="decimal" value={handoffPrice} onChange={(event) => setHandoffPrice(event.target.value)} placeholder="0.00" /></label>
              <label>Currency<input value={handoffCurrency} maxLength={3} onChange={(event) => setHandoffCurrency(event.target.value.toUpperCase())} placeholder="USD" /></label>
              <label>Sale date<input type="date" value={handoffSoldDate} onChange={(event) => setHandoffSoldDate(event.target.value)} /></label>
            </div>
            <button type="button" onClick={generateCommunityReportCsv}>Create preflight CSV</button>
          </> : <p>That report cannot be handed off. It must be a completed-sale report marked for import first.</p>}
        </section>
      ) : null}
      <section className="price-import-form" aria-label="Price import preflight form">
        <div className="price-import-field">
          <label htmlFor="edition-search">Exact RAR edition for this batch</label>
          {selectedEdition ? (
            <div className="selected-edition">
              <strong>{editionLabel(selectedEdition)}</strong>
              <button type="button" onClick={clearSelectedEdition}>Change edition</button>
            </div>
          ) : (
            <>
              <input id="edition-search" value={query} onChange={(event) => { setQuery(event.target.value); setResult(null); }} placeholder="Start typing a verified edition title" autoComplete="off" />
              {loadingSuggestions ? <p className="field-help">Looking for verified editions...</p> : null}
              {visibleSuggestions.length ? (
                <div className="edition-suggestions">
                  {visibleSuggestions.map((edition) => <button type="button" key={edition.id} onClick={() => selectEdition(edition)}>{editionLabel(edition)}</button>)}
                </div>
              ) : null}
            </>
          )}
        </div>

        {selectedEdition ? (
          <div className="price-import-field">
            <label htmlFor="collection-run">Recorded collection run</label>
            {loadingCollectionRuns ? <p className="field-help">Loading runs for this exact edition...</p> : null}
            {!loadingCollectionRuns && !collectionRuns.length ? <p className="field-help">No run recorded yet. <Link href="/collection-profiles">Record the completed-listings check first.</Link></p> : null}
            {collectionRuns.length ? <select id="collection-run" value={selectedCollectionRunId} onChange={(event) => { setSelectedCollectionRunId(event.target.value); setResult(null); }}><option value="">Choose the run that found this batch</option>{collectionRuns.map((run) => <option key={run.id} value={run.id}>{collectionRunLabel(run)}</option>)}</select> : null}
          </div>
        ) : null}

        <div className="price-import-field">
          <label htmlFor="csv-file">CSV batch</label>
          <input id="csv-file" type="file" accept=".csv,text/csv" onChange={handleFile} />
          <p className="field-help">Up to 500 rows. Use <a href="/templates/marketplace-price-import-v1.csv">the RAR v1 template</a>; only confirmed sales are accepted.</p>
        </div>

        <label className="price-import-field price-import-csv" htmlFor="csv-text">
          Paste CSV (or load it above)
          <textarea id="csv-text" value={csv} onChange={(event) => { setCsv(event.target.value); setResult(null); }} placeholder="Paste the complete CSV including the header row" rows={10} spellCheck={false} />
        </label>

        <div className="price-import-actions">
          <button type="button" disabled={working || !selectedCollectionRunId} onClick={() => runImport(true)}>{working ? "Checking..." : "Run preflight"}</button>
          <button className="secondary-action" type="button" disabled={working || !selectedCollectionRunId || !result?.readyCount} onClick={() => runImport(false)}>Queue {result?.readyCount ?? 0} safe sale{result?.readyCount === 1 ? "" : "s"}</button>
          {message ? <p role="status">{message}</p> : null}
        </div>
      </section>

      {result ? (
        <section className="preflight-results" aria-live="polite">
          <div className="preflight-summary">
            <div><strong>{result.totalRows}</strong><span>rows checked</span></div>
            <div className="ready"><strong>{result.readyCount}</strong><span>safe to queue</span></div>
            <div className="duplicate"><strong>{result.duplicateCount}</strong><span>duplicates skipped</span></div>
            <div className="blocked"><strong>{result.blockedCount}</strong><span>blocked</span></div>
          </div>
          <p className="preflight-edition"><span>Batch edition</span>{editionLabel(result.edition)}</p>
          <div className="preflight-table-wrap">
            <table>
              <thead><tr><th>Row</th><th>Status</th><th>Listing</th><th>Sale</th><th>Result</th></tr></thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.rowNumber}>
                    <td>{row.rowNumber}</td>
                    <td><span className={`import-status ${row.status}`}>{row.status}</span></td>
                    <td><strong>{row.listingTitle || "Missing title"}</strong><small>{row.source || "Unknown source"} | {row.externalId || "No ID"}</small><small>{row.evidenceImageUrl ? "Copyright-page reference supplied" : "No copyright-page reference yet — this sale cannot be verified."}</small></td>
                    <td>{row.price && row.currency ? `${row.currency} ${row.price}` : "Not usable"}<small>{row.soldDate || "No sale date"}</small></td>
                    <td>{row.issues.length ? row.issues.join("; ") : <><strong>{row.match ? `${row.match.confidence} match signal (${row.match.score}/100)` : "Ready for staff review"}</strong><small>{row.match?.reasons.join("; ") || "No match signal recorded"}</small></>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
