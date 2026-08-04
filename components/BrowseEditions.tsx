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
  printing_of_edition_id: string | null;
};

type SortMode = "newest" | "title" | "completeness";

function completenessScore(edition: BrowseEdition) {
  return Number(edition.cover_verification_status === "verified") + Number(Boolean(edition.edition_statement)) + Number(Boolean(edition.printing_number)) + Number(Boolean(edition.variant_name));
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
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [collectibleType, setCollectibleType] = useState("all");
  const [firstPrintOnly, setFirstPrintOnly] = useState(searchParams.get("printing") === "first");
  const [coverOnly, setCoverOnly] = useState(false);
  const [verifiedSalesOnly, setVerifiedSalesOnly] = useState(searchParams.get("evidence") === "verified-sales");
  const [japaneseOnly, setJapaneseOnly] = useState(false);
  const [sort, setSort] = useState<SortMode>("newest");

  const languages = useMemo(() => [...new Set(editions.map((edition) => edition.language).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const publishers = useMemo(() => [...new Set(editions.map((edition) => publisherDisplayName(edition.publisher)).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const collectibleTypes = useMemo(() => [...new Set(editions.map((edition) => edition.collectible_type).filter((value): value is string => Boolean(value)))].sort(), [editions]);
  const editionsById = useMemo(() => new Map(editions.map((edition) => [edition.id, edition])), [editions]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return editions.filter((edition) => {
      const searchable = [edition.title, edition.series, edition.volume_number, edition.publisher, publisherDisplayName(edition.publisher), edition.language, edition.isbn_13, editionDescriptor(edition)].filter(Boolean).join(" ").toLocaleLowerCase();
      return (!term || searchable.includes(term))
        && (language === "all" || edition.language === language)
        && (publisher === "all" || publisherDisplayName(edition.publisher) === publisher)
        && (collectibleType === "all" || edition.collectible_type === collectibleType)
        && (!firstPrintOnly || edition.printing_number === 1)
        && (!coverOnly || edition.cover_verification_status === "verified")
        && (!verifiedSalesOnly || edition.verified_sale_count > 0)
        && (!japaneseOnly || edition.language === "Japanese");
    });
  }, [collectibleType, coverOnly, editions, firstPrintOnly, japaneseOnly, language, publisher, query, verifiedSalesOnly]);

  const groups = useMemo(() => {
    const compare = bySort(sort);
    const filteredIds = new Set(filtered.map((edition) => edition.id));
    const bySeries = new Map<string, BrowseEdition[]>();
    for (const edition of filtered) {
      const key = edition.series || edition.title || "Uncategorised";
      const list = bySeries.get(key) ?? [];
      list.push(edition);
      bySeries.set(key, list);
    }

    const groupList = [...bySeries.entries()].map(([series, list]) => {
      // Editions proven to be a specific printing of another edition in this
      // same filtered view are shown directly after that general record,
      // rather than as an unrelated card elsewhere in the grid.
      const generals = list.filter((edition) => !edition.printing_of_edition_id || !filteredIds.has(edition.printing_of_edition_id));
      const printingsByParent = new Map<string, BrowseEdition[]>();
      for (const edition of list) {
        if (edition.printing_of_edition_id && filteredIds.has(edition.printing_of_edition_id)) {
          const siblings = printingsByParent.get(edition.printing_of_edition_id) ?? [];
          siblings.push(edition);
          printingsByParent.set(edition.printing_of_edition_id, siblings);
        }
      }
      generals.sort(compare);
      const ordered: BrowseEdition[] = [];
      for (const general of generals) {
        ordered.push(general);
        ordered.push(...(printingsByParent.get(general.id) ?? []).sort(compare));
      }

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
    <div className="browse-controls" aria-label="Filter editions">
      <label>Search<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, series or ISBN" /></label>
      <label>Language<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="all">All languages</option>{languages.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Publisher<select value={publisher} onChange={(event) => setPublisher(event.target.value)}><option value="all">All publishers</option>{publishers.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Type<select value={collectibleType} onChange={(event) => setCollectibleType(event.target.value)}><option value="all">All types</option>{collectibleTypes.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
      <label>Sort<select value={sort} onChange={(event) => setSort(event.target.value as SortMode)}><option value="newest">Newest added</option><option value="title">Title A–Z</option><option value="completeness">Most documented</option></select></label>
      <label className="browse-checkbox"><input type="checkbox" checked={firstPrintOnly} onChange={(event) => setFirstPrintOnly(event.target.checked)} /> First printing only</label>
      <label className="browse-checkbox"><input type="checkbox" checked={coverOnly} onChange={(event) => setCoverOnly(event.target.checked)} /> Catalogue cover sourced</label>
      <label className="browse-checkbox"><input type="checkbox" checked={verifiedSalesOnly} onChange={(event) => setVerifiedSalesOnly(event.target.checked)} /> Verified sales recorded</label>
      <label className="browse-checkbox"><input type="checkbox" checked={japaneseOnly} onChange={(event) => setJapaneseOnly(event.target.checked)} /> Japanese originals only</label>
    </div>
    <div className="browse-result-count"><strong>{resultCount}</strong> catalogue-ready edition{resultCount === 1 ? "" : "s"} across <strong>{groups.length}</strong> series</div>
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
                const generalEdition = edition.printing_of_edition_id ? editionsById.get(edition.printing_of_edition_id) : null;
                return (
                  <Link href={`/edition/${edition.id}`} className="browse-card" key={edition.id}>
                    <EditionCover title={edition.title} series={edition.series} volumeNumber={edition.volume_number} language={edition.language} imageUrl={edition.cover_image_url} imageStatus={edition.cover_verification_status} className="browse-card-cover" />
                    <div className="browse-card-body">
                      <p>{[edition.collectible_type?.replaceAll("_", " "), edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language].filter(Boolean).join(" · ")}</p>
                      <h2>{edition.title || "Untitled manga"}</h2>
                      <strong>{editionDescriptor(edition)}</strong>
                      {generalEdition ? <em className="browse-card-printing-of">↳ Printing of {generalEdition.title}</em> : null}
                      <span>{publisherDisplayName(edition.publisher)}</span>
                      <small>{edition.isbn_13 || "ISBN pending"}</small>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    ) : <p className="status-message">No verified editions match those filters. Try removing a filter or searching by ISBN.</p>}
  </>;
}
