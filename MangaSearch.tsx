"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

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
};

type MangaSearchProps = {
  initialResults: Manga[];
};

export default function MangaSearch({ initialResults }: MangaSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Manga[]>(initialResults.slice(0, 4));
  const [searched, setSearched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();

    if (!term) {
      setResults(initialResults.slice(0, 4));
      setSearched(false);
      setMessage("Showing recent additions. Enter a title, publisher or ISBN to search.");
      return;
    }

    const safeTerm = term.replace(/[,%()]/g, " ");
    setIsLoading(true);
    setMessage("");

    const { data, error } = await supabase
      .from("manga_editions")
      .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number")
      .or(`title.ilike.%${safeTerm}%,series.ilike.%${safeTerm}%,publisher.ilike.%${safeTerm}%,isbn_13.ilike.%${safeTerm}%`)
      .limit(8);

    setIsLoading(false);
    setSearched(true);

    if (error) {
      setResults([]);
      setMessage("The search is unavailable right now. Please try again.");
      return;
    }

    setResults((data ?? []) as Manga[]);
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

      <div className="search-results" aria-live="polite">
        {message ? <p className="search-message">{message}</p> : null}
        {!message && results.length === 0 && searched ? (
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
            </div>
            <small>{item.isbn_13 || "ISBN pending"}</small>
          </Link>
        ))}
      </div>
    </div>
  );
}
