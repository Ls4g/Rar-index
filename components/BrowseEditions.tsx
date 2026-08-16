"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import EditionCover from "@/components/EditionCover";
import { editionDescriptor, evidenceStatusLabel, publisherDisplayName } from "@/lib/editionDisplay";

export type BrowseEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  publisher: string | null;
  language: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  collectible_type: string | null;
  issue_year: number | null;
  issue_number_label: string | null;
  cumulative_issue_no: number | null;
  madb_id: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
  created_at: string | null;
  verified_sale_count: number;
  firstPrintProvenCount: number;
  printingNotIdentifiedCount: number;
  hasFirstPrintEvidence: boolean;
};

type SortMode = "newest" | "title" | "completeness";

// What "well documented" means for sort/filter purposes: a confirmed cover,
// a proven sale, and proven first-print evidence — not just how many
// optional fields happen to be filled in.
function completenessScore(edition: BrowseEdition) {
  return Number(edition.cover_verification_status === "verified") + Number(edition.verified_sale_count > 0) + Number(Boolean(edition.edition_statement)) + Number(edition.hasFirstPrintEvidence);
}

function bySort(sort: SortMode) {
  return (left: BrowseEdition, right: BrowseEdition) => {
    if (sort === "title") return (left.title ?? "").localeCompare(right.title ?? "");
    if (sort === "completeness") return completenessScore(right) - completenessScore(left) || (left.title ?? "").localeCompare(right.title ?? "");
    return (right.created_at ?? "").localeCompare(left.created_at ?? "");
  };
}

export default function BrowseEditions({ editions }: { editions: BrowseEdition[] }) {
  const searchParams = useSearchParams();
  const bestDocumented = searchParams.get("collection") === "best-documented";
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [language, setLanguage] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [collectibleType, setCollectibleType] = useState("all");
  const [firstPrintOnly, setFirstPrintOnly] = useState(searchParams.get("printing") === "first");
  const [coverOnly, setCoverOnly] = useState(bestDocumented);
  const [verifiedSalesOnly, setVerifiedSalesOnly] = useState(bestDocumented || searchParams.get("evidence") === "verified-sales");
  const [japaneseOnly, setJapaneseOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>(bestDocumented ? "completeness" : "newest");

  const languages = useMemo(() => [...new Set(editions.map((edition) => edition.language).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const publishers = useMemo(() => [...new Set(editions.map((edition) => publisherDisplayName(edition.publisher)).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const collectibleTypes = useMemo(() => [...new Set(editions.map((edition) => edition.collectible_type).filter((value): value is string => Boolean(value)))].sort(), [editions]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return editions.filter((edition) => {
      const searchable = [edition.title, edition.series, edition.volume_number, edition.issue_year, edition.issue_number_label, edition.cumulative_issue_no, edition.madb_id, edition.publisher, publisherDisplayName(edition.publisher), edition.language, edition.isbn_13, editionDescriptor(edition)].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!term || searchable.includes(term))
        && (language === "all" || edition.language === language)
        && (publisher === "all" || publisherDisplayName(edition.publisher) === publisher)
        && (collectibleType === "all" || edition.collectible_type === collectibleType)
        && (!firstPrintOnly || edition.hasFirstPrintEvidence)
        && (!coverOnly || edition.cover_verification_status === "verified")
        && (!verifiedSalesOnly || edition.verified_sale_count > 0)
        && (!japaneseOnly || edition.language === "Japanese");
    });
  }, [collectibleType, coverOnly, editions, firstPrintOnly, japaneseOnly, language, publisher, query, verifiedSalesOnly]);

  const groups = useMemo(() => {
    const compare = bySort(sort);
    const bySeries = new Map<string, BrowseEdition[]>();
    for (const edition of filtered) {
      const key = edition.series || edition.title || "Uncategorised";
      const list = bySeries.get(key) ?? [];
      list.push(edition);
      bySeries.set(key, list);
    }

    const groupList = [...bySeries.entries()].map(([series, list]) => {
      const ordered = [...list].sort(compare);
      const bestCompleteness = Math.max(...list.map(completenessScore));
      const latestCreatedAt = list.reduce((latest, edition) => (edition.created_at && edition.created_at > latest ? edition.created_at : latest), "");
      const verifiedCount = list.filter((edition) => edition.verified_sale_count > 0).length;
      return { series, editions: ordered, bestCompleteness, latestCreatedAt, verifiedCount, total: list.length };
    });

    groupList.sort((left, right) => {
      if (sort === "title") return left.series.localeCompare(right.series);
      if (sort === "completeness") return right.bestCompleteness - left.bestCompleteness || left.series.localeCompare(right.series);
      return right.latestCreatedAt.localeCompare(left.latestCreatedAt);
    });

    return groupList;
  }, [filtered, sort]);

  const resultCount = filtered.length;

  return <>
    {bestDocumented ? (
      <div className="browse-collection-banner">
        <strong>Best-documented editions</strong>
        <p>Filtered to records with a verified sale and a verified cover. Remove a filter below to see the wider catalogue.</p>
      </div>
    ) : null}
    <div className="browse-search-row">
      <label className="browse-search-field">
        <span className="sr-only">Search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, issue, series or ISBN" />
      </label>
      <div className="browse-chip-row" role="group" aria-label="Quick filters">
        <button type="button" className={`browse-chip${verifiedSalesOnly ? " is-active" : ""}`} aria-pressed={verifiedSalesOnly} onClick={() => setVerifiedSalesOnly((value) => !value)}>Verified prices</button>
        <button type="button" className={`browse-chip${firstPrintOnly ? " is-active" : ""}`} aria-pressed={firstPrintOnly} onClick={() => setFirstPrintOnly((value) => !value)}>First-print evidence</button>
        <button type="button" className={`browse-chip${japaneseOnly ? " is-active" : ""}`} aria-pressed={japaneseOnly} onClick={() => setJapaneseOnly((value) => !value)}>Japanese originals</button>
        <button type="button" className={`browse-chip${coverOnly ? " is-active" : ""}`} aria-pressed={coverOnly} onClick={() => setCoverOnly((value) => !value)}>Covers sourced</button>
      </div>
    </div>
    <details className="browse-controls">
      <summary>Language, publisher, type &amp; sort</summary>
      <div className="browse-controls-grid">
        <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{languages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Publisher<select value={publisher} onChange={(event) => setPublisher(event.target.value)}><option value="all">All publishers</option>{publishers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>Type<select value={collectibleType} onChange={(event) => setCollectibleType(event.target.value)}><option value="all">All types</option>{collectibleTypes.map((value) => <option key={value} value={value}>{value === "zasshi" ? "Magazine issues" : value.replaceAll("_", " ")}</option>)}</select></label>
        <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="newest">Newest added</option><option value="title">Title A–Z</option><option value="completeness">Most documented</option></select></label>
      </div>
    </details>
    <div className="browse-result-count"><strong>{resultCount}</strong> publication{resultCount === 1 ? "" : "s"} across <strong>{groups.length}</strong> series</div>
    {groups.length ? (
      <div className="browse-series-list">
        {groups.map((group) => (
          <section className="browse-series-group" key={group.series} aria-label={group.series}>
            <div className="browse-series-header">
              <h2>{group.series}</h2>
              <span>{group.total} edition{group.total === 1 ? "" : "s"}{group.verifiedCount ? ` · ${group.verifiedCount} with verified sales` : ""}</span>
            </div>
            <div className="browse-grid">
              {group.editions.map((edition) => {
                const hasVerifiedCover = edition.cover_verification_status === "verified";
                const wellDocumented = hasVerifiedCover && edition.verified_sale_count > 0;
                const isMagazine = edition.collectible_type === "zasshi";
                const issue = isMagazine
                  ? [edition.issue_year, edition.issue_number_label ? `Issue ${edition.issue_number_label}` : null].filter(Boolean).join(" · ")
                  : null;
                const identifier = isMagazine
                  ? edition.cumulative_issue_no ? `Cumulative issue ${edition.cumulative_issue_no}` : edition.madb_id ? `MADB ${edition.madb_id}` : "Issue identity verified"
                  : edition.isbn_13 || "ISBN pending";
                return (
                  <Link href={`/edition/${edition.id}`} className={`browse-card${wellDocumented ? " is-well-documented" : ""}`} key={edition.id}>
                    <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="browse-card-cover" />
                    <div className="browse-card-body">
                      <p>{[isMagazine ? "Magazine issue" : edition.collectible_type?.replaceAll("_", " "), isMagazine ? issue : edition.series, !isMagazine && edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language].filter(Boolean).join(" · ")}</p>
                      <h2>{(isMagazine ? edition.series : edition.title) || "Untitled publication"}</h2>
                      <strong>{isMagazine ? issue || "Magazine issue" : editionDescriptor(edition)}</strong>
                      {!isMagazine && edition.hasFirstPrintEvidence ? (
                        <em className="browse-card-print-badge is-proven">{edition.firstPrintProvenCount} proven first-print sale{edition.firstPrintProvenCount === 1 ? "" : "s"}</em>
                      ) : !isMagazine && edition.printingNotIdentifiedCount > 0 ? (
                        <em className="browse-card-print-badge is-unidentified">{edition.printingNotIdentifiedCount} sale{edition.printingNotIdentifiedCount === 1 ? "" : "s"} with printing not identified</em>
                      ) : null}
                      <span>{publisherDisplayName(edition.publisher)}</span>
                      <span className={`browse-card-evidence${wellDocumented ? " is-well-documented" : ""}`}>{evidenceStatusLabel(hasVerifiedCover, edition.verified_sale_count)}</span>
                      <small>{identifier}</small>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    ) : <p className="status-message">No publications match those filters. Try removing a filter or searching by ISBN.</p>}
  </>;
}
