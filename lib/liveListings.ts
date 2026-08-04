export function normaliseListingText(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasMatchingVolume(listingTitle: string, volumeNumber: string | number | null) {
  if (!volumeNumber) return true;
  const volume = String(volumeNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactVolume = new RegExp(`\\b(?:vol(?:ume)?\\.?|book|part|#)\\s*${volume}\\b|\\b${volume}\\s*(?:巻|kan)`, "i");
  const multiVolume = new RegExp(`\\b(?:vol(?:ume)?\\.?|book|part)\\s*\\d+\\s*(?:-|–|to)\\s*\\d+\\b|\\b(?:set|lot|collection|box\\s*set|complete)\\b`, "i");
  return exactVolume.test(listingTitle) && !multiVolume.test(listingTitle);
}

export type PlausibilityListing = { listing_title: string | null };
export type PlausibilityEdition = { title: string | null; series: string | null; volume_number: string | number | null };

// A Scout profile casts a deliberately broad net. The public page should
// only surface a listing when the title itself makes the series and volume
// clear; everything else remains a staff review lead.
export function isPlausibleLiveListing(listing: PlausibilityListing, edition: PlausibilityEdition) {
  const listingTitle = listing.listing_title ?? "";
  const seriesName = normaliseListingText(edition.series || edition.title);
  return seriesName.length >= 3
    && normaliseListingText(listingTitle).includes(seriesName)
    && hasMatchingVolume(listingTitle, edition.volume_number);
}

export function listingType(payload: unknown) {
  if (!payload || typeof payload !== "object") return "Live listing";
  const item = (payload as { item?: unknown }).item;
  if (!item || typeof item !== "object") return "Live listing";
  const options = (item as { buyingOptions?: unknown }).buyingOptions;
  if (!Array.isArray(options)) return "Live listing";
  if (options.includes("AUCTION")) return "Auction";
  if (options.includes("FIXED_PRICE")) return "Buy it now";
  return "Live listing";
}

export function formatListingEnd(value: string | null) {
  if (!value) return "End time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "End time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}
