"use client";

import { ChangeEvent, useEffect, useState } from "react";

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

export default function PriceImportForm() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Edition[]>([]);
  const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Preflight | null>(null);
  const [message, setMessage] = useState("");
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2 || selectedEdition) {
      setSuggestions([]);
      return;
    }

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
        body: JSON.stringify({ editionId: selectedEdition.id, csv, dryRun }),
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
      <section className="price-import-form" aria-label="Price import preflight form">
        <div className="price-import-field">
          <label htmlFor="edition-search">Exact RAR edition for this batch</label>
          {selectedEdition ? (
            <div className="selected-edition">
              <strong>{editionLabel(selectedEdition)}</strong>
              <button type="button" onClick={() => { setSelectedEdition(null); setQuery(""); setResult(null); }}>Change edition</button>
            </div>
          ) : (
            <>
              <input id="edition-search" value={query} onChange={(event) => { setQuery(event.target.value); setResult(null); }} placeholder="Start typing a verified edition title" autoComplete="off" />
              {loadingSuggestions ? <p className="field-help">Looking for verified editions...</p> : null}
              {suggestions.length ? (
                <div className="edition-suggestions">
                  {suggestions.map((edition) => <button type="button" key={edition.id} onClick={() => { setSelectedEdition(edition); setSuggestions([]); setResult(null); }}>{editionLabel(edition)}</button>)}
                </div>
              ) : null}
            </>
          )}
        </div>

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
          <button type="button" disabled={working} onClick={() => runImport(true)}>{working ? "Checking..." : "Run preflight"}</button>
          <button className="secondary-action" type="button" disabled={working || !result?.readyCount} onClick={() => runImport(false)}>Queue {result?.readyCount ?? 0} safe sale{result?.readyCount === 1 ? "" : "s"}</button>
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
                    <td>{row.issues.length ? row.issues.join("; ") : "Ready for staff review"}</td>
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
