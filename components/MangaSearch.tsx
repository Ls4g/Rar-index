"use client";

import { FormEvent, useState } from "react";
import { supabase } from "@/lib/supabase";

export type Manga = {
  id: string | number;
  title: string | null;
  publisher: string | null;
  isbn: string | null;
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
      .from("manga")
      .select("id, title, publisher, isbn")
      .or(`title.ilike.%${safeTerm}%,publisher.ilike.%${safeTerm}%,isbn.ilike.%${safeTerm}%`)
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
          <div className="search-result" key={item.id}>
            <span className="result-marker" aria-hidden="true" />
            <div>
              <strong>{item.title || "Untitled manga"}</strong>
              <span>{item.publisher || "Publisher not recorded"}</span>
            </div>
            <small>{item.isbn || "ISBN pending"}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
