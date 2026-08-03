export type MarketplaceQueryEdition = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  printing_number: number | null;
};

function queryName(edition: MarketplaceQueryEdition) {
  return edition.series?.trim() || edition.title?.trim() || "";
}

function volumeTerm(edition: MarketplaceQueryEdition) {
  return edition.volume_number !== null && edition.volume_number !== undefined && String(edition.volume_number).trim()
    ? `Vol. ${edition.volume_number}`
    : "Vol.";
}

// Keep the terms that distinguish a collectible manga search from a generic
// title or ISBN lookup. eBay does not need quotation marks for this workflow.
export function buildMarketplaceQuery(edition: MarketplaceQueryEdition) {
  return [
    queryName(edition),
    "manga",
    volumeTerm(edition),
    edition.language?.trim() || null,
    edition.isbn_13?.trim() || null,
    edition.printing_number === 1 ? "first print" : null,
  ].filter(Boolean).join(" ");
}

export function normalizeMarketplaceQuery(query: string, edition: MarketplaceQueryEdition) {
  const withoutQuotes = query.replace(/["“”]/g, " ").replace(/\s+/g, " ").trim();
  const needsManga = !/\bmanga\b/i.test(withoutQuotes);
  const needsVolume = !/\bvol(?:ume)?\.?\s*\d*/i.test(withoutQuotes);
  return [withoutQuotes, needsManga ? "manga" : null, needsVolume ? volumeTerm(edition) : null]
    .filter(Boolean)
    .join(" ");
}
