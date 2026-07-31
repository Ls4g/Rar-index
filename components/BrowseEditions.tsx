"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import EditionCover from "@/components/EditionCover";

export type BrowseEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  publisher: string | null;
  language: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
  collectible_type: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

function editionLabel(edition: BrowseEdition) {
  return edition.variant_name || (edition.printing_number ? `${edition.printing_number}${edition.printing_number === 1 ? "st" : "th"} printing` : edition.edition_statement || "Edition details pending");
}

export default function BrowseEditions({ editions }: { editions: BrowseEdition[] }) {
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [collectibleType, setCollectibleType] = useState("all");
  const [firstPrintOnly, setFirstPrintOnly] = useState(false);
  const languages = useMemo(() => [...new Set(editions.map((edition) => edition.language).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const publishers = useMemo(() => [...new Set(editions.map((edition) => edition.publisher).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const collectibleTypes = useMemo(() => [...new Set(editions.map((edition) => edition.collectible_type).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return editions.filter((edition) => {
      const searchable = [edition.title, edition.series, edition.volume_number, edition.publisher, edition.language, edition.isbn_13, editionLabel(edition)].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!term || searchable.includes(term)) && (language === "all" || edition.language === language) && (publisher === "all" || edition.publisher === publisher) && (collectibleType === "all" || edition.collectible_type === collectibleType) && (!firstPrintOnly || edition.printing_number === 1);
    });
  }, [collectibleType, editions, firstPrintOnly, language, publisher, query]);

  return <>
    <div className="browse-controls" aria-label="Filter editions">
      <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, series or ISBN" /></label>
      <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{languages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Publisher<select value={publisher} onChange={(event) => setPublisher(event.target.value)}><option value="all">All publishers</option>{publishers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Type<select value={collectibleType} onChange={(event) => setCollectibleType(event.target.value)}><option value="all">All types</option>{collectibleTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label className="browse-checkbox"><input type="checkbox" checked={firstPrintOnly} onChange={(event) => setFirstPrintOnly(event.target.checked)} /> First printing only</label>
    </div>
    <div className="browse-result-count"><strong>{results.length}</strong> matching verified edition{results.length === 1 ? "" : "s"}</div>
    {results.length ? <div className="browse-grid">{results.map((edition) => <Link href={`/edition/${edition.id}`} className="browse-card" key={edition.id}>
      <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="browse-card-cover" />
      <div className="browse-card-body">
        <p>{[edition.collectible_type?.replaceAll("_", " "), edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language].filter(Boolean).join(" · ")}</p>
        <h2>{edition.title || "Untitled manga"}</h2>
        <strong>{editionLabel(edition)}</strong>
        <span>{edition.publisher || "Publisher pending"}</span>
        <small>{edition.isbn_13 || "ISBN pending"}</small>
      </div>
    </Link>)}</div> : <p className="status-message">No verified editions match those filters. Try removing a filter or searching by ISBN.</p>}
  </>;
}
