"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import EditionCover from "@/components/EditionCover";
import { supabase } from "@/lib/supabase";
import { trackPublicJourney } from "@/components/PublicJourneyTracker";

type Suggestion = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

function searchParts(value: string) {
  const volume = value.match(/\bvol(?:ume)?\.?\s*(\d+)\b/i)?.[1];
  const title = value.replace(/\bvol(?:ume)?\.?\s*\d+\b/gi, " ").replace(/\s+/g, " ").trim();
  return { title, volume };
}

export default function HomeCatalogueSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    const { title, volume } = searchParts(query);
    const safeTitle = title.replace(/[,%_()]/g, " ").trim();
    if (safeTitle.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(false);
      let request = supabase.from("manga_editions")
        .select("id,title,series,volume_number,language,publisher,isbn_13,cover_image_url,cover_verification_status")
        .eq("is_verified", true).eq("record_kind", "publication")
        .or(`series.ilike.%${safeTitle}%,title.ilike.%${safeTitle}%,isbn_13.ilike.%${safeTitle}%`)
        .limit(60);
      if (volume) request = request.eq("volume_number", volume);
      const { data, error: searchError } = await request;
      if (cancelled) return;

      const matches = (data ?? []) as Suggestion[];
      matches.sort((left, right) => {
        const rank = (item: Suggestion) =>
          (item.series?.toLowerCase() === safeTitle.toLowerCase() ? 0 : 1);
        return rank(left) - rank(right)
          || (left.series ?? left.title ?? "").localeCompare(right.series ?? right.title ?? "")
          || Number(left.volume_number ?? 0) - Number(right.volume_number ?? 0)
          || (left.language ?? "").localeCompare(right.language ?? "");
      });
      setResults(matches.slice(0, 6));
      setLoading(false);
      setError(Boolean(searchError));
    }, 250);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  const showSuggestions = open && query.trim().length >= 2;

  return <form action="/browse" className="rar-concept-hero-search" role="search"
    onSubmit={() => { if (query.trim().length >= 2) trackPublicJourney("catalogue_search"); }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
    <label htmlFor="rar-home-search">SEARCH THE CATALOGUE</label>
    <div>
      <input autoComplete="off" aria-autocomplete="list" aria-controls="rar-home-suggestions"
        aria-expanded={showSuggestions} aria-activedescendant={showSuggestions && activeIndex >= 0 ? `rar-home-option-${activeIndex}` : undefined}
        id="rar-home-search" name="q" placeholder="Try One Piece, Vol. 2 or an ISBN" role="combobox" type="search"
        value={query} onChange={(event) => {
          setQuery(event.target.value);
          setResults([]);
          setActiveIndex(-1);
          setLoading(searchParts(event.target.value).title.length >= 2);
          setError(false);
          setOpen(true);
        }} onFocus={() => setOpen(true)} onKeyDown={(event) => {
          if (event.key === "Escape") { setOpen(false); setActiveIndex(-1); }
          if (event.key === "Enter" && activeIndex >= 0 && results[activeIndex]) {
            event.preventDefault();
            trackPublicJourney("catalogue_search");
            router.push(`/edition/${results[activeIndex].id}`);
          }
          if (!results.length || !showSuggestions) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
          if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, -1)); }
        }} />
      <button type="submit">Explore manga <span aria-hidden="true">↗</span></button>
    </div>
    {showSuggestions ? <ul className="rar-home-suggestions" id="rar-home-suggestions" role="listbox" aria-label="Matching editions">
      {loading ? <li className="rar-home-suggestion-message" role="status">Finding editions…</li> : null}
      {!loading && error ? <li className="rar-home-suggestion-message" role="status">Suggestions are unavailable. You can still search the catalogue.</li> : null}
      {!loading && !error && !results.length ? <li className="rar-home-suggestion-message" role="status">No matching editions yet. Try the full catalogue search.</li> : null}
      {!loading && !error && results.map((edition, index) => <li key={edition.id} role="presentation">
        <button aria-selected={activeIndex === index} className={activeIndex === index ? "is-active" : ""}
          id={`rar-home-option-${index}`} onClick={() => { trackPublicJourney("catalogue_search"); router.push(`/edition/${edition.id}`); }}
          onMouseEnter={() => setActiveIndex(index)} role="option" type="button">
          <EditionCover className="rar-home-suggestion-cover" imageStatus={edition.cover_verification_status}
            imageUrl={edition.cover_image_url} language={edition.language} series={edition.series}
            title={edition.title} volumeNumber={edition.volume_number} />
          <span><strong>{edition.series || edition.title || "Manga edition"}</strong>
            <small>{[edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.publisher].filter(Boolean).join(" · ")}</small></span>
        </button>
      </li>)}
      {!loading && !error && results.length ? <li role="presentation"><button className="rar-home-suggestion-all" onClick={() => { trackPublicJourney("catalogue_search"); router.push(`/browse?q=${encodeURIComponent(query.trim())}`); }} type="button">See all catalogue results ↗</button></li> : null}
    </ul> : null}
  </form>;
}
