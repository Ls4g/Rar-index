export function normaliseListingText(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasMatchingVolume(listingTitle: string, volumeNumber: string | number | null) {
  if (!volumeNumber) return true;
  const volume = String(volumeNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactVolume = new RegExp(`\\b(?:vol(?:ume)?\\.?|book|part)\\s*${volume}\\b|#\\s*${volume}\\b|\\b${volume}\\s*(?:巻|kan)`, "i");
  const multiVolume = new RegExp(`\\b(?:vol(?:ume)?\\.?|book|part)\\s*\\d+\\s*(?:-|–|to)\\s*\\d+\\b|\\b(?:set|lot|collection|box\\s*set|complete)\\b`, "i");
  return exactVolume.test(listingTitle) && !multiVolume.test(listingTitle);
}

export type PlausibilityListing = { listing_title: string | null };
export type PlausibilityEdition = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  publisher?: string | null;
  format?: string | null;
  isbn_13?: string | null;
};

// Publishers commonly seen in manga/comics eBay listings, including ones
// that never appear in RAR's own catalogue. A listing naming one of these
// that isn't this edition's own publisher is a confident mismatch (e.g. a
// Dark Horse or Epic Comics "Akira" listing on a Kodansha edition's page).
const KNOWN_PUBLISHERS: Record<string, string[]> = {
  "viz media": ["viz media", "viz"],
  kodansha: ["kodansha"],
  "dark horse comics": ["dark horse"],
  shueisha: ["shueisha"],
  "epic comics": ["epic comics"],
  marvel: ["marvel"],
  "graphitti designs": ["graphitti"],
  "yen press": ["yen press"],
  "seven seas": ["seven seas entertainment", "seven seas"],
  "vertical comics": ["vertical comics", "vertical inc"],
  tokyopop: ["tokyopop"],
  "del rey": ["del rey"],
  "udon entertainment": ["udon"],
  "one peace books": ["one peace"],
  denpa: ["denpa"],
};

function mentionedPublisherKeys(text: string) {
  const normalized = text.toLocaleLowerCase();
  return Object.entries(KNOWN_PUBLISHERS)
    .filter(([, tokens]) => tokens.some((token) => normalized.includes(token)))
    .map(([key]) => key);
}

function editionPublisherKey(publisher: string | null | undefined) {
  if (!publisher) return null;
  const normalized = publisher.toLocaleLowerCase();
  return Object.entries(KNOWN_PUBLISHERS).find(([key, tokens]) => normalized.includes(key) || tokens.some((token) => normalized.includes(token)))?.[0] ?? null;
}

function listingIsbn(text: string) {
  const compact = text.replace(/[\s-]/g, "");
  return compact.match(/97[89]\d{10}/)?.[0] ?? null;
}

const HARDCOVER_WORDS = /\b(hardcover|hardback|cased|hard\s*cover)\b/i;
const PAPERBACK_WORDS = /\b(paperback|softcover|soft\s*cover|trade\s*paperback|tank[oō]bon)\b/i;

function formatContradicts(text: string, editionFormat: string | null | undefined) {
  if (!editionFormat) return false;
  const normalized = editionFormat.toLocaleLowerCase();
  if ((normalized.includes("paper") || normalized.includes("soft") || normalized.includes("tank")) && HARDCOVER_WORDS.test(text)) return true;
  if (normalized.includes("hard") && PAPERBACK_WORDS.test(text)) return true;
  return false;
}

// A Scout profile casts a deliberately broad net across a whole series and
// volume — that alone is not enough to show a listing as a public buying
// opportunity, since different real-world editions (different publisher,
// printing, or binding) can share the same series and volume number. RAR's
// evidence-first principle applies here too: an ISBN in the listing must
// match exactly; without one, the listing must not contradict this
// edition's known publisher or format. A listing that neither confirms nor
// contradicts stays a staff-only Scout lead rather than a public listing.
export function isPlausibleLiveListing(listing: PlausibilityListing, edition: PlausibilityEdition) {
  const listingTitle = listing.listing_title ?? "";
  const seriesName = normaliseListingText(edition.series || edition.title);
  const seriesAndVolumeMatch = seriesName.length >= 3
    && normaliseListingText(listingTitle).includes(seriesName)
    && hasMatchingVolume(listingTitle, edition.volume_number);
  if (!seriesAndVolumeMatch) return false;

  const candidateIsbn = listingIsbn(listingTitle);
  if (candidateIsbn) return Boolean(edition.isbn_13) && candidateIsbn === edition.isbn_13;

  if (formatContradicts(listingTitle, edition.format)) return false;

  const mentioned = mentionedPublisherKeys(listingTitle);
  if (mentioned.length) {
    const editionKey = editionPublisherKey(edition.publisher);
    return editionKey !== null && mentioned.includes(editionKey);
  }

  // No ISBN, no named publisher, no format contradiction: nothing actively
  // rules this listing out, but nothing confirms it either.
  return false;
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
