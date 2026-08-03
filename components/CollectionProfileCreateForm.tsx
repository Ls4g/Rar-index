"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { buildMarketplaceQuery } from "@/lib/marketplaceQuery";

type Edition = { id: string; title: string | null; series: string | null; volume_number: string | number | null; language: string | null; isbn_13: string | null; printing_number: number | null; edition_statement: string | null; variant_name: string | null };
type Source = { id: string; name: string | null };
function label(edition: Edition) { return [edition.title, edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.printing_number ? `Printing ${edition.printing_number}` : null, edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null].filter(Boolean).join(" | "); }
function defaultQuery(edition: Edition) { return buildMarketplaceQuery(edition); }
function defaultScope(edition: Edition) { return `Completed listings only. Match ${[edition.title, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null, edition.printing_number === 1 ? "first printing" : null].filter(Boolean).join(", ")}. Exclude ended listings and records that conflict with these identifiers.`; }

export default function CollectionProfileCreateForm({ initialEditionId = "" }: { initialEditionId?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(""); const [suggestions, setSuggestions] = useState<Edition[]>([]); const [edition, setEdition] = useState<Edition | null>(null); const [sources, setSources] = useState<Source[]>([]);
  const [sourceId, setSourceId] = useState(""); const [searchQuery, setSearchQuery] = useState(""); const [scopeNotes, setScopeNotes] = useState(""); const [interval, setInterval] = useState("7"); const [message, setMessage] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!initialEditionId || edition) return;
    const controller = new AbortController();
    fetch(`/api/collection-profiles?editionId=${encodeURIComponent(initialEditionId)}`, { signal: controller.signal }).then(async (response) => {
      const data = await response.json() as { edition?: Edition; sources?: Source[]; error?: string }; if (!response.ok || !data.edition) throw new Error(data.error ?? "The edition could not be loaded.");
      setEdition(data.edition); setSources(data.sources ?? []); setSearchQuery(defaultQuery(data.edition)); setScopeNotes(defaultScope(data.edition));
    }).catch((error) => { if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "The edition could not be loaded."); });
    return () => controller.abort();
  }, [edition, initialEditionId]);
  useEffect(() => {
    if (edition || query.trim().length < 2) return;
    const controller = new AbortController(); const timer = window.setTimeout(() => {
      fetch(`/api/collection-profiles?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal }).then(async (response) => {
        const data = await response.json() as { editions?: Edition[]; sources?: Source[]; error?: string }; if (!response.ok) throw new Error(data.error ?? "Suggestions could not be loaded."); setSuggestions(data.editions ?? []); setSources(data.sources ?? []);
      }).catch((error) => { if ((error as Error).name !== "AbortError") setMessage(error instanceof Error ? error.message : "Suggestions could not be loaded."); });
    }, 220);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [edition, query]);
  function choose(value: Edition) { setEdition(value); setQuery(""); setSuggestions([]); setSearchQuery(defaultQuery(value)); setScopeNotes(defaultScope(value)); setMessage(""); }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!edition) { setMessage("Choose the exact verified RAR edition first."); return; }
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/collection-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editionId: edition.id, sourceId, searchQuery, scopeNotes, collectionIntervalDays: Number(interval) }) });
      const data = await response.json() as { profileId?: string; error?: string }; if (!response.ok || !data.profileId) throw new Error(data.error ?? "The profile could not be created.");
      router.push(`/collection-profiles/${data.profileId}`); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The profile could not be created."); } finally { setSaving(false); }
  }
  return <form className="quick-sale-form" onSubmit={submit}>
    <div className="quick-sale-step"><span>1</span><div><strong>Choose an exact edition</strong><p>Only verified RAR editions can receive a collection profile.</p></div></div>
    <div className="price-import-field">{edition ? <div className="selected-edition"><strong>{label(edition)}</strong><button type="button" onClick={() => { setEdition(null); setSearchQuery(""); setScopeNotes(""); }}>Change edition</button></div> : <><label htmlFor="profile-edition-search">Search a verified RAR edition</label><input id="profile-edition-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Start typing an edition title" autoComplete="off" />{suggestions.length ? <div className="edition-suggestions">{suggestions.map((item) => <button type="button" key={item.id} onClick={() => choose(item)}>{label(item)}</button>)}</div> : null}</>}</div>
    {edition ? <><div className="quick-sale-step"><span>2</span><div><strong>Define the repeatable search</strong><p>The wording must help future reviewers include the right editions and exclude the wrong ones.</p></div></div><div className="quick-sale-grid"><label>Marketplace source<select required value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose source</option>{sources.map((source) => <option key={source.id} value={source.id}>{source.name ?? "Unnamed marketplace"}</option>)}</select></label><label>Check every<select value={interval} onChange={(event) => setInterval(event.target.value)}><option value="1">Day</option><option value="7">Week</option><option value="14">Two weeks</option><option value="30">Month</option></select></label><label className="quick-sale-wide">Exact marketplace query<input required value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Series manga Vol. 1 English ISBN" /><small>RAR adds manga and the volume number by default. Quotation marks are removed before the profile is saved.</small></label><label className="quick-sale-wide">Edition boundary note<textarea required minLength={20} value={scopeNotes} onChange={(event) => setScopeNotes(event.target.value)} rows={5} /></label></div><div className="quick-sale-submit"><button type="submit" disabled={saving}>{saving ? "Creating..." : "Create collection profile"}</button><p>This creates the search record only. Next, record a completed-listings check and then add any real sales for review.</p></div></> : null}
    {message ? <p className="quick-sale-message" role="status">{message}</p> : null}
  </form>;
}
