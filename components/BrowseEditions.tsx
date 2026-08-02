"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import EditionCover from "@/components/EditionCover";
import { editionDescriptor, publisherDisplayName } from "@/lib/editionDisplay";

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
  created_at: string | null;
  verified_sale_count: number;
};

export default function BrowseEditions({ editions }: { editions: BrowseEdition[] }) {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [collectibleType, setCollectibleType] = useState("all");
  const [firstPrintOnly, setFirstPrintOnly] = useState(searchParams.get("printing") === "first");
  const [coverOnly, setCoverOnly] = useState(false);
  const [verifiedSalesOnly, setVerifiedSalesOnly] = useState(searchParams.get("evidence") === "verified-sales");
  const [sort, setSort] = useState<"newest" | "title" | "completeness">("newest");
  const languages = useMemo(() => [...new Set(editions.map((edition) => edition.language).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const publishers = useMemo(() => [...new Set(editions.map((edition) => publisherDisplayName(edition.publisher)).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const collectibleTypes = useMemo(() => [...new Set(editions.map((edition) => edition.collectible_type).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const results = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const completeness = (edition: BrowseEdition) => Number(edition.cover_verification_status === "verified") + Number(Boolean(edition.edition_statement)) + Number(Boolean(edition.printing_number)) + Number(Boolean(edition.variant_name));
    return editions
      .filter((edition) => {
        const searchable = [edition.title, edition.series, edition.volume_number, edition.publisher, publisherDisplayName(edition.publisher), edition.language, edition.isbn_13, editionDescriptor(edition)].filter(Boolean).join(" ").toLocaleLowerCase();
        return (!term || searchable.includes(term))
          && (language === "all" || edition.language === language)
          && (publisher === "all" || publisherDisplayName(edition.publisher) === publisher)
          && (collectibleType === "all" || edition.collectible_type === collectibleType)
          && (!firstPrintOnly || edition.printing_number === 1)
          && (!coverOnly || edition.cover_verification_status === "verified")
          && (!verifiedSalesOnly || edition.verified_sale_count > 0);
      })
      .sort((left, right) => {
        if (sort === "title") return (left.title ?? "").localeCompare(right.title ?? "");
        if (sort === "completeness") return completeness(right) - completeness(left) || (left.title ?? "").localeCompare(right.title ?? "");
        return (right.created_at ?? "").localeCompare(left.created_at ?? "");
      });
  }, [collectibleType, coverOnly, editions, firstPrintOnly, language, publisher, query, sort, verifiedSalesOnly]);

  return <>
    <div className="browse-controls" aria-label="Filter editions">
      <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, series or ISBN" /></label>
      <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{languages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Publisher<select value={publisher} onChange={(event) => setPublisher(event.target.value)}><option value="all">All publishers</option>{publishers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Type<select value={collectibleType} onChange={(event) => setCollectibleType(event.target.value)}><option value="all">All types</option>{collectibleTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest added</option><option value="title">Title A–Z</option><option value="completeness">Most documented</option></select></label>
      <label className="browse-checkbox"><input type="checkbox" checked={firstPrintOnly} onChange={(event) => setFirstPrintOnly(event.target.checked)} /> First printing only</label>
      <label className="browse-checkbox"><input type="checkbox" checked={coverOnly} onChange={(event) => setCoverOnly(event.target.checked)} /> Catalogue cover sourced</label>
      <label className="browse-checkbox"><input type="checkbox" checked={verifiedSalesOnly} onChange={(event) => setVerifiedSalesOnly(event.target.checked)} /> Verified sales recorded</label>
    </div>
    <div className="browse-result-count"><strong>{results.length}</strong> catalogue-ready edition{results.length === 1 ? "" : "s"}</div>
    {results.length ? <div className="browse-grid">{results.map((edition) => <Link href={`/edition/${edition.id}`} className="browse-card" key={edition.id}>
      <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="browse-card-cover" />
      <div className="browse-card-body">
        <p>{[edition.collectible_type?.replaceAll("_", " "), edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language].filter(Boolean).join(" · ")}</p>
        <h2>{edition.title || "Untitled manga"}</h2>
        <strong>{editionDescriptor(edition)}</strong>
        <span>{publisherDisplayName(edition.publisher)}</span>
        <small>{edition.isbn_13 || "ISBN pending"}</small>
      </div>
    </Link>)}</div> : <p className="status-message">No verified editions match those filters. Try removing a filter or searching by ISBN.</p>}
  </>;
}
