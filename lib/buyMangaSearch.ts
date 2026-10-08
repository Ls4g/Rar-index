export type BuyMangaSort = "recent" | "price_asc" | "price_desc";

export type BuyMangaFilters = {
  query: string;
  language: string;
  currency: string;
  maxPrice: number | null;
  sort: BuyMangaSort;
};

export type BuyMangaSearchItem = {
  lead: {
    listing_title: string;
    listing_price: number | null;
    currency: string | null;
    last_seen_at: string;
  };
  edition: {
    title: string | null;
    series: string | null;
    volume_number: string | number | null;
    language: string | null;
  };
};

function words(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function matchesBuyMangaFilters(item: BuyMangaSearchItem, filters: BuyMangaFilters) {
  if (filters.language && item.edition.language?.toLocaleLowerCase() !== filters.language.toLocaleLowerCase()) return false;
  if (filters.currency && item.lead.currency?.toUpperCase() !== filters.currency.toUpperCase()) return false;
  if (filters.maxPrice !== null && filters.currency) {
    if (item.lead.listing_price === null || item.lead.listing_price > filters.maxPrice) return false;
  }
  const queryWords = words(filters.query);
  if (!queryWords.length) return true;
  const listingWords = words([
    item.lead.listing_title,
    item.edition.series,
    item.edition.title,
    item.edition.volume_number === null ? "" : `Vol ${item.edition.volume_number}`,
  ].filter(Boolean).join(" "));
  return queryWords.every((queryWord) => listingWords.some((word) =>
    /\d/.test(queryWord) ? word === queryWord : word.includes(queryWord)));
}

export function sortBuyMangaItems<T extends BuyMangaSearchItem>(items: T[], sort: BuyMangaSort, currency: string) {
  return [...items].sort((left, right) => {
    if (sort !== "recent" && currency) {
      const a = left.lead.listing_price;
      const b = right.lead.listing_price;
      if (a === null && b !== null) return 1;
      if (b === null && a !== null) return -1;
      if (a !== null && b !== null && a !== b) return sort === "price_asc" ? a - b : b - a;
    }
    return right.lead.last_seen_at.localeCompare(left.lead.last_seen_at);
  });
}
