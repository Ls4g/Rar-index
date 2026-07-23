"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Manga = {
  id: string | number;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  author: string | null;
  publisher: string | null;
  language: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
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
      .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name")
      .or(`title.ilike.%${safeTerm}%,series.ilike.%${safeTerm}%,publisher.ilike.%${safeTerm}%,isbn_13.ilike.%${safeTerm}%`)
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
      setResults([]);
      setSearched(false);
      setMessage("");
      setIsLoading(false);
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

  return (
    <div className="search-panel">
      <form onSubmit={handleSearch} className="search-form">
        <label className="sr-only" htmlFor="manga-search">
          Search the manga index
        </label>
        <input
          id="manga-search"
          name="manga-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search title, publisher or ISBN"
          autoComplete="off"
        />
        <button type="submit" disabled={isLoading}>
          {isLoading ? "Searching…" : "Search index"}
        </button>
      </form>

      {(isLoading || message || results.length > 0 || searched) ? (
        <div className="search-results" aria-live="polite">
          {isLoading ? <p className="search-message">Searching editions…</p> : null}
          {message ? <p className="search-message">{message}</p> : null}
          {!isLoading && !message && results.length === 0 && searched ? (
            <p className="search-message">No editions found yet. Try a different title or ISBN.</p>
          ) : null}
          {results.map((item) => (
            <Link className="search-result" href={`/edition/${item.id}`} key={item.id}>
              <span className="result-marker" aria-hidden="true" />
              <div>
                <strong>{item.title || "Untitled manga"}</strong>
                <span>
                  {[item.series, item.volume_number ? `Vol. ${item.volume_number}` : null, item.publisher]
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
