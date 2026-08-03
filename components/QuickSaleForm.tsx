"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Edition = { id: string; title: string | null; series: string | null; volume_number: string | number | null; language: string | null; isbn_13: string | null; printing_number: number | null; edition_statement: string | null; variant_name: string | null };
type Source = { id: string; name: string | null };
type Profile = { id: string; source: { name: string | null } | null };
type CollectionRun = { id: string; profile_id: string; checked_at: string; checked_by: string; candidate_count: number; notes: string };

function editionLabel(edition: Edition) {
  return [edition.title, edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.printing_number ? `Printing ${edition.printing_number}` : null, edition.edition_statement, edition.variant_name, edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null].filter(Boolean).join(" | ");
}
function runLabel(run: CollectionRun, profiles: Profile[]) {
  const source = profiles.find((profile) => profile.id === run.profile_id)?.source?.name ?? "Marketplace";
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(run.checked_at));
  return `${date} · ${source} · ${run.checked_by} · ${run.candidate_count} candidates`;
}

export default function QuickSaleForm() {
  const params = useSearchParams(); const initialEditionId = params.get("editionId") ?? "";
  const [query, setQuery] = useState(""); const [suggestions, setSuggestions] = useState<Edition[]>([]); const [selectedEdition, setSelectedEdition] = useState<Edition | null>(null);
  const [sources, setSources] = useState<Source[]>([]); const [profiles, setProfiles] = useState<Profile[]>([]); const [runs, setRuns] = useState<CollectionRun[]>([]);
  const [collectionRunId, setCollectionRunId] = useState(""); const [sourceId, setSourceId] = useState(""); const [sourceListingUrl, setSourceListingUrl] = useState(""); const [externalId, setExternalId] = useState("");
  const [listingTitle, setListingTitle] = useState(""); const [soldDate, setSoldDate] = useState(""); const [salePrice, setSalePrice] = useState(""); const [currency, setCurrency] = useState("GBP"); const [saleType, setSaleType] = useState("unknown");
  const [evidenceImageUrl, setEvidenceImageUrl] = useState(""); const [intakeNotes, setIntakeNotes] = useState(""); const [message, setMessage] = useState(""); const [loading, setLoading] = useState(false);
  const visibleSuggestions = query.trim().length >= 2 && !selectedEdition ? suggestions : [];
  const hasRun = useMemo(() => runs.length > 0, [runs]);

  useEffect(() => {
    if (!initialEditionId || selectedEdition) return;
    const controller = new AbortController();
    fetch(`/api/add-sale?editionId=${encodeURIComponent(initialEditionId)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { edition?: Edition; profiles?: Profile[]; runs?: CollectionRun[]; sources?: Source[]; error?: string };
        if (!response.ok || !data.edition) throw new Error(data.error ?? "The selected edition could not be loaded.");
        setSelectedEdition(data.edition); setProfiles(data.profiles ?? []); setRuns(data.runs ?? []); setSources(data.sources ?? []);
      })
      .catch((error) => { if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "The selected edition could not be loaded."); });
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
        setSuggestions(data.editions ?? []); setSources(data.sources ?? []);
      } catch (error) { if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Edition suggestions could not be loaded."); }
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectedEdition]);

  useEffect(() => {
    if (!selectedEdition) return;
    const controller = new AbortController();
    fetch(`/api/add-sale?editionId=${encodeURIComponent(selectedEdition.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { profiles?: Profile[]; runs?: CollectionRun[]; sources?: Source[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Collection runs could not be loaded.");
        setProfiles(data.profiles ?? []); setRuns(data.runs ?? []); setSources(data.sources ?? []);
      })
      .catch((error) => { if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Collection runs could not be loaded."); });
    return () => controller.abort();
  }, [selectedEdition]);

  function selectEdition(edition: Edition) { setSelectedEdition(edition); setSuggestions([]); setProfiles([]); setRuns([]); setCollectionRunId(""); setMessage(""); }
  function resetEdition() { setSelectedEdition(null); setQuery(""); setRuns([]); setProfiles([]); setCollectionRunId(""); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedEdition) { setMessage("Choose the exact RAR edition first."); return; }
    setLoading(true); setMessage("");
    try {
      const response = await fetch("/api/add-sale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId: selectedEdition.id, collectionRunId, sourceId, sourceListingUrl, externalId, listingTitle, soldDate, salePrice, currency, saleType, evidenceImageUrl, intakeNotes }) });
      const data = await response.json() as { observationId?: string; error?: string };
      if (!response.ok) throw new Error(data.error ?? "The sale could not be queued.");
      setMessage("Saved to the review queue. It is not public market evidence yet.");
      setExternalId(""); setSourceListingUrl(""); setListingTitle(""); setSoldDate(""); setSalePrice(""); setEvidenceImageUrl(""); setIntakeNotes("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "The sale could not be queued."); } finally { setLoading(false); }
  }

  return <form className="quick-sale-form" onSubmit={submit}>
    <div className="quick-sale-step"><span>1</span><div><strong>Select the exact RAR edition</strong><p>Sales only ever attach to one existing, verified edition record.</p></div></div>
    <div className="price-import-field">{selectedEdition ? <div className="selected-edition"><strong>{editionLabel(selectedEdition)}</strong><button type="button" onClick={resetEdition}>Change edition</button></div> : <><label htmlFor="quick-sale-edition">Search a verified RAR edition</label><input id="quick-sale-edition" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing an edition title" autoComplete="off" />{visibleSuggestions.length ? <div className="edition-suggestions">{visibleSuggestions.map((edition) => <button type="button" key={edition.id} onClick={() => selectEdition(edition)}>{editionLabel(edition)}</button>)}</div> : null}</>}</div>
    {selectedEdition ? <>
      <div className="quick-sale-step"><span>2</span><div><strong>Link the completed-listings check</strong><p>This is the audit trail for where the candidate came from.</p></div></div>
      <div className="price-import-field"><label htmlFor="quick-sale-run">Recorded collection run</label>{hasRun ? <select id="quick-sale-run" required value={collectionRunId} onChange={(event) => setCollectionRunId(event.target.value)}><option value="">Choose the check that found this sale</option>{runs.map((run) => <option value={run.id} key={run.id}>{runLabel(run, profiles)}</option>)}</select> : <p className="field-help">No completed-listings check is recorded yet. <Link href="/collection-profiles">Record one in Collection profiles first.</Link></p>}</div>
      <div className="quick-sale-step"><span>3</span><div><strong>Capture the original sale</strong><p>These fields create a candidate for review—not an automatic valuation.</p></div></div>
      <div className="quick-sale-grid">
        <label>Marketplace source<select required value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name ?? "Unnamed marketplace"}</option>)}</select></label>
        <label>Sale type<select value={saleType} onChange={(event) => setSaleType(event.target.value)}><option value="unknown">Unknown</option><option value="auction">Auction</option><option value="fixed_price">Fixed price</option><option value="best_offer">Best offer</option></select></label>
        <label className="quick-sale-wide">Original completed-listing link<input required type="url" value={sourceListingUrl} onChange={(event) => setSourceListingUrl(event.target.value)} placeholder="https://…" /></label>
        <label>Marketplace listing ID<input value={externalId} onChange={(event) => setExternalId(event.target.value)} placeholder="Auto-read from eBay link when possible" /></label>
        <label>Sold date<input required type="date" value={soldDate} onChange={(event) => setSoldDate(event.target.value)} /></label>
        <label className="quick-sale-wide">Listing title<input required value={listingTitle} onChange={(event) => setListingTitle(event.target.value)} placeholder="Copy the title exactly as shown" /></label>
        <label>Sold price<input required inputMode="decimal" value={salePrice} onChange={(event) => setSalePrice(event.target.value)} placeholder="0.00" /></label>
        <label>Currency<input required maxLength={3} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} placeholder="GBP" /></label>
        <label className="quick-sale-wide">Copyright-page proof link <small>Optional; add when claiming a first print.</small><input type="url" value={evidenceImageUrl} onChange={(event) => setEvidenceImageUrl(event.target.value)} placeholder="https://…" /></label>
        <label className="quick-sale-wide">Intake note <small>Optional; useful context for the reviewer.</small><textarea value={intakeNotes} onChange={(event) => setIntakeNotes(event.target.value)} placeholder="What did you check before adding this?" rows={3} /></label>
      </div>
      <div className="quick-sale-submit"><button type="submit" disabled={loading || !hasRun}>{loading ? "Saving…" : "Queue sale for review"}</button><p>After saving, open <Link href="/review">the review queue</Link> and verify or exclude it with an evidence note.</p></div>
    </> : null}
    {message ? <p className="quick-sale-message" role="status">{message}</p> : null}
  </form>;
}
