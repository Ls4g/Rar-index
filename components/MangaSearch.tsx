"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import EditionCover from "@/components/EditionCover";

export type Manga = {
  id: string | number;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  author: string | null;
  publisher: string | null;
  language: string | null;
  country: string | null;
  isbn_13: string | null;
  format?: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
  collectible_type: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

function editionLabel(item: Manga) {
  if (item.variant_name) return item.variant_name;
  if (item.printing_number) return `${item.printing_number}${item.printing_number === 1 ? "st" : "th"} printing`;
  return item.edition_statement || "Standard edition";
}

export default function MangaSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Manga[]>([]);
  const [searched, setSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const searchVersion = useRef(0);

  async function searchEditions(searchTerm: string) {
    const term = searchTerm.trim();

    if (!term) {
      setResults([]);
      setSearched(false);
      setMessage("");
      return;
    }

    const safeTerm = term.replace(/[,%()]/g, " ");
    const requestId = ++searchVersion.current;
    setIsLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("manga_editions")
      .select("id, title, series, volume_number, author, publisher, language, country, isbn_13, edition_statement, printing_number, variant_name, collectible_type, cover_image_url, cover_verification_status")
      .or(`title.ilike.%${safeTerm}%,series.ilike.%${safeTerm}%,publisher.ilike.%${safeTerm}%,language.ilike.%${safeTerm}%,country.ilike.%${safeTerm}%,isbn_13.ilike.%${safeTerm}%,edition_statement.ilike.%${safeTerm}%,variant_name.ilike.%${safeTerm}%`)
      .eq("is_verified", true)
      .limit(8);

    if (requestId !== searchVersion.current) return;

    setIsLoading(false);
    setSearched(true);

    if (error) {
      setResults([]);
      setMessage("The search is unavailable right now. Please try again.");
      return;
    }

    setResults((data ?? []) as Manga[]);
  }

  useEffect(() => {
    const term = query.trim();

    if (!term) {
      searchVersion.current += 1;
      return;
    }

    const timer = window.setTimeout(() => {
      void searchEditions(term);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchEditions(query);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (!value.trim()) {
      searchVersion.current += 1;
      setResults([]);
      setSearched(false);
      setMessage("");
      setIsLoading(false);
    }
  }

  return (
    <div className="search-panel">
      <form onSubmit={handleSearch} className="search-form">
        <label className="sr-only" htmlFor="manga-search">
          Search manga by title, publisher or ISBN
        </label>
        <input
          id="manga-search"
          name="manga-search"
          value={query}
          onChange={(event) => handleQueryChange(event.target.value)}
          placeholder='Try "One Piece Vol. 1" — or a title, publisher or ISBN'
          autoComplete="off"
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? "Searching…" : "Search"}
        </button>
      </form>

      {(isLoading || message || results.length > 0 || searched) ? (
        <div className="search-results" aria-live="polite" aria-label="Edition suggestions">
          {isLoading ? <p className="search-message">Searching editions…</p> : null}
          {message ? <p className="search-message">{message}</p> : null}
          {!isLoading && !message && results.length === 0 && searched ? (
            <p className="search-message">No editions found yet. Try a different title or ISBN.</p>
          ) : null}
          {results.map((item) => (
            <Link className="search-result" href={`/edition/${item.id}`} key={item.id}>
              <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="search-result-cover" />
              <div>
                <strong>{item.title || "Untitled manga"}</strong>
                <span>
                  {[item.collectible_type?.replaceAll("_", " "), item.series, item.volume_number ? `Vol. ${item.volume_number}` : null, item.language, item.publisher]
                    .filter(Boolean)
                    .join(" · ") || "Edition details not recorded"}
                </span>
                <em className="search-edition-label">{editionLabel(item)}</em>
              </div>
              <small>{item.isbn_13 || "ISBN pending"}</small>
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
