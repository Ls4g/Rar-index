export function normaliseListingText(value: string | null | undefined) {
  return (value ?? "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

// The numeric-range half also accepts "&"/"and"/"," between two volume
// numbers ("Volume 1 & 2", "Vol 1, 2, 3") — just as unambiguous a lot/set
// signal as an explicit dash range, and a real, observed listing pattern.
const MULTI_VOLUME_WORDS = /\b(?:vol(?:ume)?\.?|book|part)\s*\d+\s*(?:-|–|to|&|and|,)\s*\d+\b|\b(?:set|lot|collection|box\s*set|complete)\b/i;

export function hasMatchingVolume(listingTitle: string, volumeNumber: string | number | null) {
  if (!volumeNumber) return true;
  const volume = String(volumeNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exactVolume = new RegExp(`\\b(?:vol(?:ume)?\\.?|book|part)\\s*${volume}\\b|#\\s*${volume}\\b|\\b${volume}\\s*(?:巻|kan)`, "i");
  return exactVolume.test(listingTitle) && !MULTI_VOLUME_WORDS.test(listingTitle);
}

// A listing whose title describes several volumes together (a "set", "lot",
// numeric range, or "complete series") is never a single copy of one exact
// edition, regardless of what else it says. Scout profiles are scoped to one
// specific volume, so this alone is enough to rule a lot/set listing out —
// no ISBN or publisher reading required.
export function listingIsMultiVolumeLot(listingTitle: string, volumeNumber: string | number | null) {
  return Boolean(volumeNumber) && MULTI_VOLUME_WORDS.test(listingTitle);
}

// A title naming one specific volume other than the target's — "Vol 8" on a
// Vol. 1 profile — is a plain, confident mismatch, distinct from a lot/set
// (already handled above) or a listing that names no volume at all. Returns
// the other volume number found (for feeding a match assessment) or null.
export function listingNamesOtherVolume(listingTitle: string, volumeNumber: string | number | null): string | null {
  if (!volumeNumber) return null;
  const match = listingTitle.match(/\b(?:vol(?:ume)?\.?|book|part)\s*(\d+)\b/i);
  if (match && match[1] !== String(volumeNumber)) return match[1];
  return null;
}

export type PlausibilityListing = { listing_title: string | null };
export type PlausibilityEdition = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  publisher?: string | null;
  format?: string | null;
  isbn_13?: string | null;
  language?: string | null;
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

// A best-effort read of binding/format straight out of listing text, for
// feeding a match assessment a real (if imprecise) signal instead of
// nothing. Only ever used as a conflict check against the edition's own
// recorded format — never treated as confirming a format on its own.
export function detectFormatWord(text: string): "hardcover" | "paperback" | null {
  if (HARDCOVER_WORDS.test(text)) return "hardcover";
  if (PAPERBACK_WORDS.test(text)) return "paperback";
  return null;
}

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

// Scout stores active-listing leads for later human review, one search
// profile per exact edition. The listing text is the only evidence Scout has
// before a human opens the link, so pulling an ISBN/publisher/language out of
// the title lets the same contradiction check used for public live listings
// also flag a lead as a confident non-match, worth auto-dismissing instead of
// adding to a reviewer's queue.
export function listingConflictsWithEdition(listingTitle: string, edition: PlausibilityEdition): boolean {
  if (listingIsMultiVolumeLot(listingTitle, edition.volume_number)) return true;
  if (listingNamesOtherVolume(listingTitle, edition.volume_number)) return true;
  const candidateIsbn = listingIsbn(listingTitle);
  if (candidateIsbn && edition.isbn_13 && candidateIsbn !== edition.isbn_13) return true;
  if (formatContradicts(listingTitle, edition.format)) return true;
  const candidateLanguage = listingLanguage(listingTitle);
  if (candidateLanguage && edition.language && candidateLanguage.toLocaleLowerCase() !== edition.language.toLocaleLowerCase()) return true;
  const mentioned = mentionedPublisherKeys(listingTitle);
  if (mentioned.length) {
    const editionKey = editionPublisherKey(edition.publisher);
    if (editionKey === null || !mentioned.includes(editionKey)) return true;
  }
  return false;
}

const PUBLISHER_DISPLAY_NAMES: Record<string, string> = {
  "viz media": "VIZ Media",
  kodansha: "Kodansha",
  "dark horse comics": "Dark Horse Comics",
  shueisha: "Shueisha",
  "epic comics": "Epic Comics",
  marvel: "Marvel",
  "graphitti designs": "Graphitti Designs",
  "yen press": "Yen Press",
  "seven seas": "Seven Seas",
  "vertical comics": "Vertical Comics",
  tokyopop: "Tokyopop",
  "del rey": "Del Rey",
  "udon entertainment": "Udon Entertainment",
  "one peace books": "One Peace Books",
  denpa: "Denpa",
};

function listingLanguage(text: string) {
  const normalized = text.toLocaleLowerCase();
  if (/\bjapanese\b/.test(normalized)) return "Japanese";
  if (/\benglish\b/.test(normalized)) return "English";
  return null;
}

export type ListingSignals = { isbn13: string | null; publisherName: string | null; language: string | null };

// Best-effort read of ISBN/publisher/language directly out of a listing
// title, for feeding a Scout match assessment something better than blank
// fields. None of this is treated as confirmed unless it lines up with the
// target edition's own recorded details.
export function extractListingSignals(listingTitle: string): ListingSignals {
  const mentioned = mentionedPublisherKeys(listingTitle);
  return {
    isbn13: listingIsbn(listingTitle),
    publisherName: mentioned.length ? (PUBLISHER_DISPLAY_NAMES[mentioned[0]] ?? null) : null,
    language: listingLanguage(listingTitle),
  };
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
