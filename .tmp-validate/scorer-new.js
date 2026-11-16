(function(){
const __liveListings = (() => {

// Titles like "Hunter × Hunter" use the multiplication sign, while listings
// type the letter x. Without folding the lookalikes first, the catalogue
// side normalises to "hunterhunter" and the listing side to "hunterxhunter"
// -- they never match, and every listing for that series is silently ruled
// out. Mirrors the same fix in lib/editionMatch.ts.
const CROSS_CHARACTERS = /[×✕✖⨯╳]/g;

function normaliseListingText(value                           ) {
  return (value ?? "").toLocaleLowerCase().replace(CROSS_CHARACTERS, "x").replace(/[^a-z0-9]/g, "");
}

function listingIdentity(value                                                                     ) {
  if (value.external_id?.trim()) return `external:${value.external_id.trim()}`;
  if (!value.source_listing_url) return null;
  try {
    const url = new URL(value.source_listing_url);
    const itemId = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/)?.[1];
    return itemId ? `ebay:${itemId}` : `url:${url.origin}${url.pathname}`;
  } catch {
    return `url:${value.source_listing_url.split("?")[0]}`;
  }
}

/**
 * The link RAR shows for a marketplace listing.
 *
 * Stored eBay URLs keep whatever the search returned: the keywords RAR
 * searched with (_skw), eBay's own tracking hash and, on promoted results, a
 * long opaque amdata token. None of it is needed to open the listing, and it
 * publishes RAR's search terms on every outbound link. An eBay item link is
 * cut back to its item id; any other URL is returned untouched.
 */
function publicListingUrl(value        ) {
  try {
    const url = new URL(value);
    if (!/(^|\.)ebay\.[a-z.]+$/i.test(url.hostname)) return value;
    const itemId = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/)?.[1];
    return itemId ? `${url.origin}/itm/${itemId}` : value;
  } catch {
    return value;
  }
}

/** One marketplace listing may be found by several profiles in a print family. */
function dedupeLiveListings                                                                               (listings     ) {
  const seen = new Set        ();
  return listings.filter((listing, index) => {
    const key = listingIdentity(listing) ?? `row:${index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// A record with no separate series and a volume baked into its title
// ("ONE PIECE 1") would otherwise demand listings contain "onepiece1".
// Drop the trailing volume token, but only when it is this edition's own
// volume, so titles that genuinely end in a number are untouched.
function seriesSearchName(edition                                                                                           ) {
  if (edition.series) return edition.series;
  const title = (edition.title ?? "").trim();
  const volume = edition.volume_number === null || edition.volume_number === undefined ? "" : String(edition.volume_number).trim();
  if (!title || !volume) return title;
  const escaped = volume.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = title.replace(new RegExp(`[,\\s]*(?:vol(?:ume)?\\.?\\s*)?#?\\s*${escaped}\\s*$`, "i"), "").trim();
  return stripped.length >= 3 ? stripped : title;
}

// The numeric-range half also accepts "&"/"and"/"," between two volume
// numbers ("Volume 1 & 2", "Vol 1, 2, 3") — just as unambiguous a lot/set
// signal as an explicit dash range, and a real, observed listing pattern.
const MULTI_VOLUME_WORDS = /(?:\b(?:vol(?:ume)?\.?|book|part)|#)\s*\d+\s*(?:-|–|to|&|and|,)\s*\d+\b|\b(?:set|lot|collection|box\s*set|complete)\b/i;
const SEVERAL_BOOKS = /\b(?:[2-9]|[1-9]\d)\s*books\b/i;

// Volume lists the range pattern above misses, all from lots staff dismissed
// in autumn 2026: "Vol. 5 6 22 23 24 & 29", "Vol 10 11 12", "# 1 2 3",
// "Vol.1.3.4.5", "Vol.1 ＋2". A list needs two different numbers, so the
// common "Vol 1 #1" (one volume, said twice) is not a lot. Numbers separated
// only by spaces need three of them, so "Vol 1 100% authentic" is not either.
// Ordinals ("Vol. 1 2nd print") and years ("Vol 1 2016") never count.
const VOLUME_LIST_START = /(?:\bvol(?:ume)?s?\.?|\bbooks?|#)\s*(?=\d)/gi;
const LIST_NUMBER = /^(\d{1,3})(?!\d|\s*(?:st|nd|rd|th)\b|%)/i;
const LIST_SEPARATOR = /^(\s*(?:[,.&+＋/–-]|\band\b|\bto\b)\s*|\s+)(?:#\s*)?/i;

function listsSeveralVolumes(title        ) {
  if (SEVERAL_BOOKS.test(title)) return true;
  for (const start of title.matchAll(VOLUME_LIST_START)) {
    let rest = title.slice((start.index ?? 0) + start[0].length);
    const numbers           = [];
    let punctuated = false;
    let first = LIST_NUMBER.exec(rest);
    while (first) {
      numbers.push(Number(first[1]));
      rest = rest.slice(first[0].length);
      const separator = LIST_SEPARATOR.exec(rest);
      if (!separator) break;
      const next = LIST_NUMBER.exec(rest.slice(separator[0].length));
      if (!next) break;
      if (separator[1].trim()) punctuated = true;
      rest = rest.slice(separator[0].length);
      first = next;
    }
    const distinct = new Set(numbers).size;
    if (distinct >= 2 && (punctuated || numbers.length >= 3)) return true;
  }
  return false;
}

// A different kind of book that happens to share the series and volume
// number: an omnibus or 3-in-1 (VIZBIG included), a deluxe or kanzenban
// (完全版) edition, an anniversary edition. Matched against the edition's own
// text, so an edition that IS the omnibus or deluxe one is not affected.
// Owner's rule, 16 Nov 2026: these are not leads for a single-volume record.
const EDITION_TYPES                                       = [
  { label: "an omnibus or multi-in-one edition", pattern: /\bomnibus\b|\b[2-4]\s*-?\s*in\s*-?\s*(?:1|one)\b|\b(?:two|three|four)\s*-?\s*in\s*-?\s*one\b|\bvizbig\b|\bviz\s+big\b/i },
  { label: "a deluxe edition", pattern: /\bdeluxe?\b/i },
  { label: "a kanzenban (perfect) edition", pattern: /完全版|\bkanzenban\b|\bperfect\s+edition\b/i },
  { label: "an anniversary edition", pattern: /\b\d{1,3}(?:st|nd|rd|th)?\s+anniversary\b|\banniversary\s+edition\b/i },
];

function listingEditionTypeConflict(listingTitle        , editionText        ) {
  for (const type of EDITION_TYPES) {
    if (type.pattern.test(listingTitle) && !type.pattern.test(editionText)) return type.label;
  }
  return null;
}

// "Part N" is ambiguous. Some listings use it as the volume ("Akira Part 1"),
// but in series such as JoJo's Bizarre Adventure it names a story arc and sits
// beside the real volume ("Part 5 Vol. 1"). Read as a volume, that title
// matched a Vol. 5 profile and five Part 5 books were shown publicly against
// the 2006 Vol. 5 edition. So an explicit volume token (Vol., Book, #, 巻)
// always wins, and "Part N" is only read as the volume when the title names
// no other.
const EXPLICIT_VOLUME_TOKEN = /\b(?:vol(?:ume)?\.?|book)\s*\d+\b|#\s*\d+\b|\b\d+\s*(?:巻|kan\b)/i;

function hasMatchingVolume(listingTitle        , volumeNumber                        ) {
  if (!volumeNumber) return true;
  const rawVolume = String(volumeNumber).trim();
  const numericVolume = /^\d+$/.test(rawVolume) ? String(Number(rawVolume)) : null;
  const volume = (numericVolume ? `0*${numericVolume}` : rawVolume.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const exactVolume = new RegExp(`\\b(?:vol(?:ume)?\\.?|book)\\s*${volume}\\b|#\\s*${volume}\\b|\\b${volume}\\s*(?:巻|kan)`, "i");
  const partAsVolume = new RegExp(`\\bpart\\s*${volume}\\b`, "i");
  const named = exactVolume.test(listingTitle)
    || (!EXPLICIT_VOLUME_TOKEN.test(listingTitle) && partAsVolume.test(listingTitle));
  return named && !MULTI_VOLUME_WORDS.test(listingTitle);
}

// A listing whose title describes several volumes together (a "set", "lot",
// numeric range, or "complete series") is never a single copy of one exact
// edition, regardless of what else it says. Scout profiles are scoped to one
// specific volume, so this alone is enough to rule a lot/set listing out —
// no ISBN or publisher reading required.
// editionText (the edition's own title, format and statements) switches on the
// wider volume-list check. It is skipped when the edition is itself an
// omnibus: "Omnibus Vol. 1 (includes vols. 1, 2 & 3)" describes that one book.
function listingIsMultiVolumeLot(listingTitle        , volumeNumber                        , editionText         ) {
  if (!volumeNumber) return false;
  if (MULTI_VOLUME_WORDS.test(listingTitle)) return true;
  if (editionText === undefined || EDITION_TYPES[0].pattern.test(editionText)) return false;
  return listsSeveralVolumes(listingTitle);
}

// A title naming one specific volume other than the target's — "Vol 8" on a
// Vol. 1 profile — is a plain, confident mismatch, distinct from a lot/set
// (already handled above) or a listing that names no volume at all. Returns
// the other volume number found (for feeding a match assessment) or null.
function listingNamesOtherVolume(listingTitle        , volumeNumber                        )                {
  if (!volumeNumber) return null;
  // An explicit volume token outranks "Part N" (see EXPLICIT_VOLUME_TOKEN):
  // "Part 5 Vol. 1" names volume 1, and "Part 3 Vol. 5" names volume 5.
  const match = listingTitle.match(/\b(?:vol(?:ume)?\.?|book)\s*(\d+)\b/i)
    ?? listingTitle.match(/\bpart\s*(\d+)\b/i);
  if (match && Number(match[1]) !== Number(volumeNumber)) return match[1];
  return null;
}

                                                                   
                                   
                       
                        
                                        
                            
                         
                          
                           
  

// Publishers commonly seen in manga/comics eBay listings, including ones
// that never appear in RAR's own catalogue. A listing naming one of these
// that isn't this edition's own publisher is a confident mismatch (e.g. a
// Dark Horse or Epic Comics "Akira" listing on a Kodansha edition's page).
const KNOWN_PUBLISHERS                           = {
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

function mentionedPublisherKeys(text        ) {
  const normalized = text.toLocaleLowerCase();
  return Object.entries(KNOWN_PUBLISHERS)
    .filter(([, tokens]) => tokens.some((token) => normalized.includes(token)))
    .map(([key]) => key);
}

/**
 * The publisher family a name belongs to ("Kodansha", "Kodansha USA" and
 * "Kodansha Comics" are all "kodansha"), or null when RAR does not know it.
 */
function publisherFamilyKey(publisher                           ) {
  return editionPublisherKey(publisher);
}

function editionPublisherKey(publisher                           ) {
  if (!publisher) return null;
  const normalized = publisher.toLocaleLowerCase();
  return Object.entries(KNOWN_PUBLISHERS).find(([key, tokens]) => normalized.includes(key) || tokens.some((token) => normalized.includes(token)))?.[0] ?? null;
}

function listingIsbn(text        ) {
  const compact = text.replace(/[\s-]/g, "");
  return compact.match(/97[89]\d{10}/)?.[0] ?? null;
}

const HARDCOVER_WORDS = /\b(hardcover|hardback|cased|hard\s*cover)\b/i;
const PAPERBACK_WORDS = /\b(paperback|softcover|soft\s*cover|trade\s*paperback|tank[oō]bon)\b/i;

// A best-effort read of binding/format straight out of listing text, for
// feeding a match assessment a real (if imprecise) signal instead of
// nothing. Only ever used as a conflict check against the edition's own
// recorded format — never treated as confirming a format on its own.
function detectFormatWord(text        )                                   {
  if (HARDCOVER_WORDS.test(text)) return "hardcover";
  if (PAPERBACK_WORDS.test(text)) return "paperback";
  return null;
}

function formatContradicts(text        , editionFormat                           ) {
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
function isPlausibleLiveListing(listing                     , edition                     ) {
  const listingTitle = listing.listing_title ?? "";
  const seriesName = normaliseListingText(seriesSearchName(edition));
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
function listingConflictsWithEdition(listingTitle        , edition                     )          {
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

// Whether a Scout lead may be shown to the public as a copy of this edition.
//
// A new lead has to pass the conservative plausibility check. A lead a person
// marked Watching used to be shown unconditionally, on the reasoning that a
// human had confirmed it. That is not what Watching records: it means "keep
// this in RAR", and 1,242 leads carry it. Listings for other books reached
// public edition pages that way. A Watching lead is still trusted over the
// automatic check, but not when its own title confidently contradicts the
// edition. The staff decision itself is never changed here; the lead stays
// Watching in Scout and only its public display is withheld.
function isPublicLiveListing(
  listing                                                 ,
  edition                     ,
) {
  if (listing.review_status === "watching") return !listingConflictsWithEdition(listing.listing_title ?? "", edition);
  return listing.review_status === "new" && isPlausibleLiveListing(listing, edition);
}

const PUBLISHER_DISPLAY_NAMES                         = {
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

function listingLanguage(text        ) {
  const normalized = text.toLocaleLowerCase();
  if (/\bjapanese\b/.test(normalized)) return "Japanese";
  if (/\benglish\b/.test(normalized)) return "English";
  return null;
}

                                                                                                              

// Best-effort read of ISBN/publisher/language directly out of a listing
// title, for feeding a Scout match assessment something better than blank
// fields. None of this is treated as confirmed unless it lines up with the
// target edition's own recorded details.
function extractListingSignals(listingTitle        )                 {
  const mentioned = mentionedPublisherKeys(listingTitle);
  return {
    isbn13: listingIsbn(listingTitle),
    publisherName: mentioned.length ? (PUBLISHER_DISPLAY_NAMES[mentioned[0]] ?? null) : null,
    language: listingLanguage(listingTitle),
  };
}

function listingType(payload         ) {
  if (!payload || typeof payload !== "object") return "Live listing";
  const item = (payload                      ).item;
  if (!item || typeof item !== "object") return "Live listing";
  const options = (item                               ).buyingOptions;
  if (!Array.isArray(options)) return "Live listing";
  if (options.includes("AUCTION")) return "Auction";
  if (options.includes("FIXED_PRICE")) return "Buy it now";
  return "Live listing";
}

function formatListingEnd(value               ) {
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

// Public-facing end label. Returns null when eBay gave no end time, which
// is the norm for fixed-price listings: a Buy It Now with no end date has
// nothing to say about when it ends, and saying "End time unavailable" on
// five of six cards read as breakage rather than as an honest blank.
// Staff keep the explicit missing-value wording via formatListingEnd, where
// knowing the field is absent is the point.
function formatListingEndLabel(value               )                {
  const formatted = formatListingEnd(value);
  return formatted === "End time unavailable" ? null : `Ends ${formatted}`;
}

// Staff variant. During triage the absence of an end time is itself worth
// knowing, so it is stated rather than dropped -- but as a phrase that
// stands on its own instead of composing into "ends End time unavailable".
function formatListingEndStaffLabel(value               ) {
  const formatted = formatListingEnd(value);
  return formatted === "End time unavailable" ? "no end time given" : `ends ${formatted}`;
}

return { normaliseListingText, publicListingUrl, dedupeLiveListings, seriesSearchName, listingEditionTypeConflict, hasMatchingVolume, listingIsMultiVolumeLot, listingNamesOtherVolume, publisherFamilyKey, detectFormatWord, isPlausibleLiveListing, listingConflictsWithEdition, isPublicLiveListing, extractListingSignals, listingType, formatListingEnd, formatListingEndLabel, formatListingEndStaffLabel };
})();

const __editionMatch = (() => {
const { publisherFamilyKey } = __liveListings;
// Reading a magazine issue out of a marketplace listing title.
//
// A tankobon anchors on its ISBN. A magazine has none, so identity has to be
// recovered from free text a seller typed, and two traps in the live Scout
// queue make the obvious approaches wrong. Both were measured against all
// 2,385 leads on 12 August 2026:
//
//   "Shonen Jump" is a VIZ imprint. 99 leads contain the phrase and every
//   single one is an English paperback -- "Hunter x Hunter Vol 1 Paperback
//   ... Shonen Jump Viz Media". Keying on the magazine's name finds 99 books
//   and no magazines, so the name is deliberately not a signal here.
//
//   "Issue" does not mean issue. Ten leads read "Vol 1 Issue 1", all of them
//   sellers restating a tankobon's volume number. An issue number alone is
//   therefore never enough; it has to be anchored to a publication year or a
//   通巻, which is what a real magazine listing carries and a book listing
//   does not.


const YEAR = /\b(19[6-9]\d|20[0-2]\d)\b/;

// Words that make a listing a book. TPB, "graphic novel" and "omnibus" are
// all common in the live queue; so is the bare "vol".
const BOOK_SHAPE = /\b(vol(?:ume)?s?\.?|tankou?bon|tankobon|graphic\s*novels?|paperbacks?|hardcovers?|tpb|omnibus|box\s*set|book\s*set|complete\s*series|manga\s*lot|3[- ]in[- ]1)\b/i;

// Japanese: 1997年34号, 1997年 34・35号, 34号. The 号 marker is unambiguous.
// A combined issue is printed 4・5合併号, so 合併 may sit between the numbers
// and the 号 that terminates them.
const JA_YEAR_ISSUE = /(\d{4})\s*年\s*([\d０-９]+(?:\s*[・･,、\-–/&]\s*[\d０-９]+)*)\s*(?:合併)?\s*号/;
const JA_ISSUE_ONLY = /([\d０-９]+(?:\s*[・･,、\-–/&]\s*[\d０-９]+)*)\s*(?:合併)?\s*号/;
const JA_CUMULATIVE = /通巻\s*(\d{1,5})/;

// English: "1997 No. 34", "1997 #34", "1997 Issue 34", and the reverse order
// "No. 34 1997". The issue token must be marked -- a bare number next to a
// year is how "Vol 1 ... 2018" produces false positives.
const EN_YEAR_FIRST = /\b(19[6-9]\d|20[0-2]\d)\b[^\d]{0,12}?(?:no\.?|#|issue|iss\.?)\s*(\d{1,2}(?:\s*[-–/&,]\s*\d{1,2})*)\b/i;
const EN_ISSUE_FIRST = /(?:no\.?|#|issue|iss\.?)\s*(\d{1,2}(?:\s*[-–/&,]\s*\d{1,2})*)\b[^\d]{0,12}?\b(19[6-9]\d|20[0-2]\d)\b/i;

function toHalfWidth(value        ) {
  return value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

function splitIssueNumbers(raw        )           {
  return toHalfWidth(raw)
    .split(/[・･,、\-–/&\s]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 99);
}

function parseIssueReference(listingTitle                           )                 {
  const title = String(listingTitle ?? "");
  const looksLikeBook = BOOK_SHAPE.test(title);

  const cumulativeMatch = title.match(JA_CUMULATIVE);
  const cumulative = cumulativeMatch ? Number(cumulativeMatch[1]) : null;

  let year                = null;
  let issueNumbers           = [];

  const jaBoth = title.match(JA_YEAR_ISSUE);
  if (jaBoth) {
    year = Number(jaBoth[1]);
    issueNumbers = splitIssueNumbers(jaBoth[2]);
  } else {
    const enYearFirst = title.match(EN_YEAR_FIRST);
    const enIssueFirst = enYearFirst ? null : title.match(EN_ISSUE_FIRST);
    if (enYearFirst) {
      year = Number(enYearFirst[1]);
      issueNumbers = splitIssueNumbers(enYearFirst[2]);
    } else if (enIssueFirst) {
      issueNumbers = splitIssueNumbers(enIssueFirst[1]);
      year = Number(enIssueFirst[2]);
    } else {
      // 号 on its own is still unambiguous even without a year beside it.
      const jaIssue = title.match(JA_ISSUE_ONLY);
      if (jaIssue) issueNumbers = splitIssueNumbers(jaIssue[1]);
      const yearOnly = title.match(YEAR);
      if (yearOnly) year = Number(yearOnly[1]);
    }
  }

  return { year, issueNumbers, cumulative, looksLikeBook };
}

// Does this listing name a magazine issue at all? A year on its own does not
// count -- almost every book listing carries a printing year.
function namesAnIssue(reference                ) {
  if (reference.cumulative !== null) return true;
  return reference.issueNumbers.length > 0 && reference.year !== null;
}

// A slabbed copy is sealed in plastic behind a grader's label, so it is a
// poorer look at a magazine than a loose copy: part of the cover is covered
// and the rest is behind perspex. Used to prefer raw copies when picking a
// photograph, and to pick graded leads out of the Scout queue.
const GRADED_TITLE = /\b(cgc|cbcs|bgs|beckett|psa|graded|slab(bed)?)\b/i;

function looksGraded(title                           ) {
  return GRADED_TITLE.test(String(title ?? ""));
}

                            
                            
                                    
                                     
  

                                
                                                                              
                                                                     
                
                    
                      
  

function assessIssueMatch(target              , listingTitle                           )                   {
  const reference = parseIssueReference(listingTitle);
  const reasons           = [];
  const conflicts           = [];
  let score = 0;

  if (reference.looksLikeBook) {
    conflicts.push("listing describes a book, not a magazine issue");
    return { score: 0, reasons, conflicts };
  }
  if (!namesAnIssue(reference)) {
    reasons.push("listing does not name a magazine issue");
    return { score: 0, reasons, conflicts };
  }

  if (target.cumulative_issue_no !== null && reference.cumulative !== null) {
    if (target.cumulative_issue_no === reference.cumulative) {
      score += 40;
      reasons.push("通巻 matches");
    } else {
      conflicts.push("通巻 conflicts with the selected issue");
    }
  }

  // The label RAR stores comes from the Media Arts Database, which records a
  // combined issue under one number where the cover prints both. A listing
  // naming either half is the same magazine.
  const targetNumbers = splitIssueNumbers(String(target.issue_number_label ?? ""));
  if (targetNumbers.length && reference.issueNumbers.length) {
    const overlap = reference.issueNumbers.some((n) => targetNumbers.includes(n));
    if (overlap) {
      score += 25;
      reasons.push("issue number matches");
    } else {
      conflicts.push("issue number conflicts with the selected issue");
    }
  } else {
    reasons.push("issue number not confirmed by the listing");
  }

  if (target.issue_year !== null && reference.year !== null) {
    if (target.issue_year === reference.year) {
      score += 20;
      reasons.push("issue year matches");
    } else {
      conflicts.push("issue year conflicts with the selected issue");
    }
  } else {
    reasons.push("issue year not confirmed by the listing");
  }

  return { score, reasons, conflicts };
}

                                  
                       
                        
                                        
                          
                         
                            
                         
                                                                              
                                                                             
                                                             
                                   
                             
                                     
                                      
                                  
                                    
                               
  

                                     
                       
                        
                               
                          
                         
                           
                         
  

                                      
                
                                                                 
                    
                      
  

// Titles like "Hunter × Hunter" use the multiplication sign, while every
// real listing types the letter x. Stripping non-alphanumerics turned the
// catalogue side into "hunterhunter" and the listing side into
// "hunterxhunter", so they could never match and every lead for that series
// scored zero on its strongest signal. Fold the lookalikes to "x" first.
const CROSS_CHARACTERS = /[×✕✖⨯╳]/g;

// Kana and kanji are kept. Stripping to [a-z0-9] erased Japanese titles to the
// empty string, so 週刊少年ジャンプ could never match itself and every
// Japanese-titled record scored zero on its strongest signal -- the same
// failure the cross-character fold above was written for, one alphabet over.
function normalise(value                                    ) {
  return String(value ?? "")
    .toLowerCase()
    .replace(CROSS_CHARACTERS, "x")
    .replace(/[^a-z0-9぀-ヿ㐀-䶿一-鿿]/g, "");
}

function escapeRegExp(value        ) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Some catalogue records carry no separate series and a title that already
// embeds the volume ("ONE PIECE 1"). Used whole, that needle asks listings
// to contain "onepiece1", which "ONE PIECE Vol.1 1997..." never does. Drop
// the trailing volume token -- but only when it is this edition's own
// volume number, so a title that genuinely ends in a number is left alone.
function seriesNeedle(target                    ) {
  if (target.series) return target.series;
  const title = (target.title ?? "").trim();
  const volume = target.volume_number === null || target.volume_number === undefined ? "" : String(target.volume_number).trim();
  if (!title || !volume) return title;
  const trailingVolume = new RegExp(`[,\\s]*(?:vol(?:ume)?\\.?\\s*)?#?\\s*${escapeRegExp(volume)}\\s*$`, "i");
  const stripped = title.replace(trailingVolume, "").trim();
  return stripped.length >= 3 ? stripped : title;
}

function normaliseIsbn(value                           ) {
  return String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function titleMatches(left               , right               ) {
  const a = normalise(left);
  const b = normalise(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

// A listing title containing the series/title name as a plain substring is
// far more common in real eBay titles than the whole (often subtitled)
// edition title appearing verbatim — "Bleach Vol 1 Manga English VIZ" should
// read as a series match against "Bleach", not fail because it doesn't also
// say "Strawberry and the Soul Reapers".
function containsNormalised(haystack               , needle               ) {
  const h = normalise(haystack);
  const n = normalise(needle);
  return Boolean(h && n && n.length >= 3 && h.includes(n));
}

function formatCategory(value                           )                                   {
  const normalized = (value ?? "").toLocaleLowerCase();
  if (!normalized) return null;
  if (/hard\s*cover|hardback|cased/.test(normalized)) return "hardcover";
  if (/paper\s*back|soft\s*cover|trade\s*paperback|tank[oō]bon/.test(normalized)) return "paperback";
  return null;
}

const FIRST_PRINTING_WORDS = /\b(?:1st|first)\s*print(?:ing)?\b|\bfirst\s*edition\b/i;
const NUMBERED_PRINTING = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:print(?:ing)?|impression)\b/i;
const WORD_PRINTINGS                         = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

function explicitPrintingNumber(value                           ) {
  const text = String(value ?? "");
  const numbered = text.match(NUMBERED_PRINTING);
  if (numbered) return Number(numbered[1]);
  const word = text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s*(?:print(?:ing)?|impression)\b/i);
  return word ? WORD_PRINTINGS[word[1].toLowerCase()] : null;
}

const SERIES_FAMILY_EXTENSIONS                           = {
  dragonball: ["dragonballz", "dragonballsuper", "dragonballgt"],
  // Boruto is Naruto's sequel series; its Vol. 1 is not Naruto Vol. 1.
  naruto: ["boruto"],
};

function seriesFamilyConflict(targetSeries               , listingTitle               ) {
  const target = normalise(targetSeries);
  const listing = normalise(listingTitle);
  return Boolean(target && listing && (SERIES_FAMILY_EXTENSIONS[target] ?? []).some((variant) => listing.includes(variant)));
}

// Weighted for how often each field is actually present in real listing
// text: a clear series/volume match is common and meaningful even with no
// ISBN, so it carries the most weight. ISBN is still valuable when present,
// but no longer dominant enough that its absence caps every otherwise-solid
// match at "insufficient" (see AGENTS.md — most eBay titles omit it).
function assessEditionMatch(target                    , candidate                       )                         {
  let score = 0;
  const reasons           = [];
  const conflicts           = [];
  const isZasshi = target.collectible_type === "zasshi";
  // Whether this target has an identity a listing could pin down at all, and
  // whether the listing actually did. See the cap at the end of the function.
  const identityExpected = isZasshi || Boolean(String(target.volume_number ?? "").trim());
  let identityConfirmed = false;

  // A magazine issue and a tankobon are never the same object, and the live
  // queue proves both directions go wrong on their own. 99 leads say "Shonen
  // Jump" and are all VIZ paperbacks, which must not match a Jump issue; and
  // a genuine Jump issue must not match One Piece Vol. 1 just because both
  // say "One Piece". Settled before anything is scored.
  if (!isZasshi) {
    const reference = parseIssueReference(candidate.title);
    if (namesAnIssue(reference) && !reference.looksLikeBook) {
      conflicts.push("listing names a magazine issue, not this book");
    }
  }

  const targetSeriesName = seriesNeedle(target);
  const differentSeriesVariant = seriesFamilyConflict(targetSeriesName, candidate.title);
  if (differentSeriesVariant) conflicts.push("listing names a different series in the same franchise");
  const seriesOrTitleMatches = !differentSeriesVariant && (titleMatches(target.title, candidate.title)
    || titleMatches(target.series, candidate.series)
    || containsNormalised(candidate.title, targetSeriesName));
  if (seriesOrTitleMatches) {
    score += 30;
    reasons.push("series/title matches");
  } else {
    reasons.push("series/title needs human inspection");
  }

  if (isZasshi) {
    // Replaces the volume and ISBN components below, which a magazine has
    // neither of. Weighted so that a listing naming the year and issue
    // number reaches the same "strong" band a matched ISBN gives a book.
    const issue = assessIssueMatch(
      {
        issue_year: target.issue_year ?? null,
        issue_number_label: target.issue_number_label ?? null,
        cumulative_issue_no: target.cumulative_issue_no ?? null,
      },
      candidate.title,
    );
    score += issue.score;
    // A matched issue number or 通巻 is what identifies a magazine.
    if (issue.score > 0) identityConfirmed = true;
    reasons.push(...issue.reasons);
    conflicts.push(...issue.conflicts);
  } else {
    const targetVolume = normalise(target.volume_number);
    const candidateVolume = normalise(candidate.volume_number);
    if (targetVolume && candidateVolume) {
      if (targetVolume === candidateVolume) {
        score += 20;
        identityConfirmed = true;
        reasons.push("volume matches");
      } else {
        conflicts.push("volume conflicts with the selected edition");
      }
    } else {
      reasons.push("volume not confirmed by the listing");
    }
  }

  const targetLanguage = normalise(target.language);
  const candidateLanguage = normalise(candidate.language);
  if (targetLanguage && candidateLanguage) {
    if (targetLanguage === candidateLanguage) {
      score += 15;
      reasons.push("language matches");
    } else {
      conflicts.push("language conflicts with the selected edition");
    }
  } else {
    reasons.push("language not supplied by the listing");
  }

  const targetPublisher = normalise(target.publisher);
  const candidatePublisher = normalise(candidate.publisher);
  if (targetPublisher && candidatePublisher) {
    // Compare publisher families, not spellings. A listing that says
    // "Kodansha" is reported as "Kodansha" while the edition is recorded as
    // "Kodansha Comics", and the literal comparison called that a conflict:
    // in November 2026 it auto-dismissed Attack on Titan and Akira leads that
    // staff had watched. Unknown publishers still compare by spelling.
    const targetFamily = publisherFamilyKey(target.publisher);
    const candidateFamily = publisherFamilyKey(candidate.publisher);
    const samePublisher = targetFamily && candidateFamily
      ? targetFamily === candidateFamily
      : targetPublisher === candidatePublisher;
    if (samePublisher) {
      score += 15;
      reasons.push("publisher matches");
    } else {
      conflicts.push("publisher conflicts with the selected edition");
    }
  } else {
    reasons.push("publisher not supplied by the listing");
  }

  if (!isZasshi) {
    const targetIsbn = normaliseIsbn(target.isbn_13);
    const candidateIsbn = normaliseIsbn(candidate.isbn_13);
    if (targetIsbn && candidateIsbn) {
      if (targetIsbn === candidateIsbn) {
        score += 20;
        // An exact ISBN names the volume implicitly.
        identityConfirmed = true;
        reasons.push("ISBN matches");
      } else {
        conflicts.push("ISBN conflicts with the selected edition");
      }
    } else {
      reasons.push("ISBN not supplied by the listing");
    }
  }

  const targetFormat = formatCategory(target.format);
  const candidateFormat = formatCategory(candidate.format);
  if (targetFormat && candidateFormat && targetFormat !== candidateFormat) {
    conflicts.push("binding/format conflicts with the selected edition");
  }

  const targetPrinting = target.printing_number ?? explicitPrintingNumber(target.edition_statement);
  const candidatePrinting = explicitPrintingNumber(candidate.title);
  const printingConflicts = targetPrinting !== null && candidatePrinting !== null && targetPrinting !== candidatePrinting;
  if (printingConflicts) {
    conflicts.push(`listing states printing ${candidatePrinting}, not printing ${targetPrinting}`);
  } else if (targetPrinting !== null && candidatePrinting === targetPrinting) {
    score += 5;
    reasons.push(`printing ${targetPrinting} matches`);
  } else if (candidate.title && FIRST_PRINTING_WORDS.test(candidate.title) && (candidatePrinting === null || candidatePrinting === 1) && (targetPrinting === null || targetPrinting === 1)) {
    score += 5;
    reasons.push("listing states first printing / first edition");
  }

  // A named variant -- a foil cover, a special jacket -- shares its ISBN with
  // the plain edition, so the listing title is the only thing that can tell
  // the two apart. Three of RAR's ISBNs carry two editions each for exactly
  // this reason, and until this existed both scored identically: a listing
  // saying "Gold Foil cover" could not be told from one that said nothing,
  // and the pair went to a human who had already been told the answer.
  //
  // Only a short, tag-like name is usable. "Gold Foil" appears verbatim in
  // real titles. A descriptive variant_name such as "1997 first printing
  // (verified)" never will, and must not be matched loosely: its "first
  // printing" fragment would then fire on any first-printing listing and
  // credit a specific edition on the strength of a word it shares with every
  // other first printing. Parenthesised and long names are skipped rather
  // than approximated.
  //
  // Deliberately one-directional. Naming the variant credits the variant
  // edition, but a title mentioning a variant is NOT a conflict for the plain
  // edition. Knowing that "Gold Foil" belongs to a sibling would require
  // knowing the other editions on the ISBN, and this function only ever sees
  // one target. Scoring the positive is enough to separate them; inventing
  // the negative would be an assertion about an edition nobody passed in.
  const variantTag = (target.variant_name ?? "").trim();
  if (candidate.title && variantTag && variantTag.length <= 24 && !/[()]/.test(variantTag)) {
    const variantPattern = new RegExp(`\\b${variantTag.split(/\s+/).map(escapeRegExp).join("\\s+")}\\b`, "i");
    if (variantPattern.test(candidate.title)) {
      score += 10;
      reasons.push(`listing names the ${variantTag} variant`);
    }
  }

  // Naming the series, the language and the publisher is worth 60 on its own,
  // which lands in "partial" without anyone having established WHICH volume
  // or issue the listing is. Measured on the live queue on 16 August 2026:
  // 1,037 of the 1,176 open leads sat in that band, against 23 strong. A band
  // holding nine in ten leads is not sorting anything, and a queue where
  // everything looks equally worth a look is a queue nobody can finish.
  //
  // So a listing that never establishes the identity of the copy cannot reach
  // "partial". It is genuinely insufficient: the evidence to tell this
  // edition from its neighbours is simply absent. It is still stored, still
  // reviewable, and still findable -- only its claim on attention drops.
  //
  // A matched ISBN counts as confirmation on its own, since it names the
  // volume implicitly.
  if (!conflicts.length && identityExpected && !identityConfirmed) {
    score = Math.min(score, 49);
    reasons.push("does not establish which copy this is");
  }

  score = Math.min(100, score);
  const confidence                                       = conflicts.length
    ? "conflict"
    : score >= 75 ? "strong"
      : score >= 50 ? "partial"
        : "insufficient";
  return { score, confidence, reasons, conflicts };
}

return { splitIssueNumbers, parseIssueReference, namesAnIssue, looksGraded, assessIssueMatch, explicitPrintingNumber, assessEditionMatch };
})();

const __scoutRules = (() => {
const { explicitPrintingNumber } = __editionMatch;
                                                            

function normalized(value        ) {
  return value.toLowerCase().replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ").trim();
}

function phraseMatches(title        , phrase        ) {
  const haystack = ` ${normalized(title)} `;
  const needle = normalized(phrase);
  return Boolean(needle && haystack.includes(` ${needle} `));
}

function explicitlyClaimsFirstPrint(title        ) {
  return explicitPrintingNumber(title) === 1 || /\bfirst\s*edition\b/i.test(title);
}

function ruleApplies(rule           , edition              , listingTitle        ) {
  if (rule.rule_type === "first_print_proof") {
    return Number(edition.printing_number) === 1 && !explicitlyClaimsFirstPrint(listingTitle);
  }
  const phrases = Array.isArray(rule.config.phrases) ? rule.config.phrases : [];
  return phrases.some((phrase) => phraseMatches(listingTitle, phrase));
}

function confidenceFor(score        , hasConflict         )                                       {
  if (hasConflict) return "conflict";
  if (score >= 75) return "strong";
  if (score >= 50) return "partial";
  return "insufficient";
}

function applyScoutRules(
  assessment                        ,
  edition              ,
  listingTitle        ,
  rules              = [],
)                       {
  let score = assessment.score;
  const reasons = [...assessment.reasons];
  const appliedRules                                       = [];

  // Existing deterministic conflicts remain authoritative. Learned rules are
  // a score-only layer and never turn a lead into an automatic dismissal.
  if (assessment.confidence !== "conflict") {
    for (const rule of rules) {
      if (rule.status !== "active" && rule.status !== "candidate") continue;
      if (!ruleApplies(rule, edition, listingTitle)) continue;
      const adjustment = Math.min(0, Number(rule.config.score_adjustment ?? 0));
      const configuredCap = rule.config.score_cap;
      const scoreCap = Number.isFinite(configuredCap) ? Number(configuredCap) : null;
      score = Math.max(0, score + adjustment);
      if (scoreCap !== null) score = Math.min(score, scoreCap);
      appliedRules.push({ id: rule.id, ruleKey: rule.rule_key, version: rule.version, adjustment, scoreCap });
      reasons.push(`RAR learned rule ${rule.rule_key} v${rule.version} adjusted this lead`);
    }
  }

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    confidence: confidenceFor(score, assessment.conflicts.length > 0),
    reasons,
    conflicts: [...assessment.conflicts],
    appliedRules,
  };
}

async function loadActiveScoutRules(admin                )                       {
  const { data: regressionIncident, error: incidentError } = await admin
    .from("agent_incidents")
    .select("id")
    .eq("incident_key", "reliability:market_scout_match")
    .eq("status", "open")
    .limit(1)
    .maybeSingle();
  if (incidentError && incidentError.code !== "42P01" && incidentError.code !== "PGRST205") {
    throw new Error(`Scout could not check reliability incidents: ${incidentError.message}`);
  }
  // A learned rule is an optional score layer. If a later human benchmark
  // proves a safety regression, the stable deterministic scorer takes over
  // until staff resolve the incident. Nothing is silently rolled back.
  if (regressionIncident) return [];
  const { data, error } = await admin
    .from("scout_rule_versions")
    .select("id,rule_key,version,rule_type,config,status")
    .eq("status", "active")
    .order("rule_key");
  // Phase 4 deploys code before its additive migration is applied. Treat a
  // missing table as no learned rules, while surfacing every other DB error.
  if (error?.code === "42P01" || error?.code === "PGRST205") return [];
  if (error) throw new Error(`Scout could not load active learning rules: ${error.message}`);
  return (data ?? [])               ;
}

function defaultRuleConfig(ruleType               , phrases           = []) {
  const cleanedPhrases = [...new Set(phrases.map((phrase) => normalized(phrase)).filter(Boolean))].slice(0, 20);
  if (ruleType === "first_print_proof") return { score_adjustment: -25, score_cap: 74 };
  if (ruleType === "multi_volume_phrase") return { phrases: cleanedPhrases, score_adjustment: -40, score_cap: 49 };
  return { phrases: cleanedPhrases, score_adjustment: -30, score_cap: 49 };
}

return { applyScoutRules, loadActiveScoutRules, defaultRuleConfig };
})();

const __scoutIngest = (() => {
const { assessEditionMatch } = __editionMatch;
const { detectFormatWord, extractListingSignals, hasMatchingVolume, listingConflictsWithEdition, listingEditionTypeConflict, listingIsMultiVolumeLot, listingNamesOtherVolume } = __liveListings;
const { applyScoutRules } = __scoutRules;
                                                            



// Reads everything a match assessment needs directly out of listing text.
// Volume gets resolved to either the target's own volume number (a
// confirmed match), a different number actually named in the title (a
// confirmed conflict), or null (not mentioned at all) — the same
// match/conflict/unknown distinction assessEditionMatch already keeps for
// every other field, rather than leaving volume permanently blank the way
// live Scout ingestion did before.
function buildCandidateFromListing(edition              , listingTitle        )                        {
  const signals = extractListingSignals(listingTitle);
  const matchesVolume = hasMatchingVolume(listingTitle, edition.volume_number);
  const otherVolume = listingNamesOtherVolume(listingTitle, edition.volume_number);
  return {
    title: listingTitle,
    series: null,
    volume_number: matchesVolume && edition.volume_number ? String(edition.volume_number) : otherVolume,
    language: signals.language,
    isbn_13: signals.isbn13,
    publisher: signals.publisherName,
    format: detectFormatWord(listingTitle),
  };
}

// The single scoring path for a Scout listing, used both when a scan first
// stores a lead and whenever the Scout Triage Inbox re-renders one — so a
// scoring-rule change takes effect immediately for every already-stored
// lead without a data migration. A multi-volume lot/set is a plain-text
// pattern or a whole-listing shape, not a structured field to weigh
// alongside the others, so it is layered on afterwards as a hard conflict
// rather than folded into assessEditionMatch itself (which stays identical
// for its other caller, CSV price-import matching).
function assessScoutListing(edition              , listingTitle        , rules              = [])                         {
  const candidate = buildCandidateFromListing(edition, listingTitle);
  const assessment = assessEditionMatch(edition, candidate);
  const editionText = [edition.title, edition.series, edition.format, edition.edition_statement, edition.variant_name].filter(Boolean).join(" ");
  if (listingIsMultiVolumeLot(listingTitle, edition.volume_number, editionText)) {
    return { ...assessment, confidence: "conflict", conflicts: [...assessment.conflicts, "listing appears to be a multi-volume lot or set"] };
  }
  // Deliberately not on the auto-dismiss list (lib/scoutAutoTriage.ts): a
  // person still sees these, marked as conflicts, because some catalogue
  // records do not yet say they are the omnibus or perfect edition.
  const editionType = listingEditionTypeConflict(listingTitle, editionText);
  if (editionType) {
    return { ...assessment, confidence: "conflict", conflicts: [...assessment.conflicts, `listing is ${editionType}, not this edition`] };
  }
  return applyScoutRules(assessment, edition, listingTitle, rules);
}

// Every Scout scan (manual, batch, or the daily cron) builds rows the same
// way. Centralising it means the title-text signal extraction and the
// auto-dismiss rule below stay in one place instead of drifting across three
// near-identical route handlers.
function buildScoutLeadRow(profileId        , sourceId        , edition              , listing                   , checkedAt        , rules              = [])                 {
  const row               = {
    profile_id: profileId,
    source_id: sourceId,
    external_id: listing.externalId,
    source_listing_url: listing.url,
    listing_title: listing.title,
    listing_price: Number.isFinite(listing.price) ? listing.price : null,
    currency: listing.currency,
    listing_condition: listing.condition,
    item_end_at: listing.itemEndAt,
    match_assessment: assessScoutListing(edition, listing.title, rules),
    raw_payload: { provider: "ebay_browse", item: listing.rawPayload },
    last_seen_at: checkedAt,
    updated_at: checkedAt,
  };
  return { row, conflictsWithEdition: row.match_assessment.confidence === "conflict" || listingConflictsWithEdition(listing.title, edition) };
}

// Stores this scan's leads, then auto-dismisses only the ones a title-text
// contradiction rules out (a multi-volume lot/set, wrong ISBN, wrong
// publisher, language, binding, printing, or series identity) and that no human has touched
// yet. A lead a staff member has already set to
// "watching" or manually "dismissed" is left alone — auto-triage never
// overwrites a human decision, and it never verifies anything as a sale.
// A search returns up to 50 results and every one used to be kept, so 28
// searches had produced 3,243 stored leads against 80 editions. Nobody can
// act on 50 copies of one book -- these are things to buy, and you only ever
// need the best few. Sales are a different table entirely and keep every row.
//
// The cap is on UNREVIEWED, still-live leads only. Anything marked watching
// or dismissed is a decision already made and is never touched, and expired
// leads are cleared before anything live is considered.
const OPEN_LEADS_PER_PROFILE = 20;

async function capOpenLeads(admin                , profileId        ) {
  const { data, error } = await admin
    .from("scout_listing_leads")
    .select("id,item_end_at,match_assessment,last_seen_at")
    .eq("profile_id", profileId)
    .eq("review_status", "new");
  if (error || !data) return { removed: 0, overflow: 0 };

  const now = Date.now();
  const score = (row                                                 ) => row.match_assessment?.score ?? 0;
  const expired = data.filter((row) => row.item_end_at && new Date(row.item_end_at).getTime() < now);
  const live = data.filter((row) => !expired.includes(row));

  // Best first, and where two score the same the one seen most recently wins.
  live.sort((a, b) => score(b) - score(a) || new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime());
  const surplus = live.slice(OPEN_LEADS_PER_PROFILE);
  const removeIds = [...expired.map((row) => row.id), ...surplus.map((row) => row.id)];
  if (!removeIds.length) return { removed: 0, overflow: 0 };

  // Deleted rather than dismissed: a dismissal is a human judgement about a
  // listing, and filling the archive with rows nobody judged would make that
  // record meaningless. Re-scans re-create anything that still matters.
  await admin.from("scout_listing_leads").delete().in("id", removeIds).eq("review_status", "new");
  return { removed: removeIds.length, overflow: surplus.length };
}

async function storeScoutLeads(admin                , profileId        , builds                  ) {
  if (!builds.length) return;
  const { error } = await admin.from("scout_listing_leads").upsert(builds.map((build) => build.row), { onConflict: "profile_id,source_id,external_id" });
  if (error) throw new Error("RAR could not store the active-listing leads.");

  const conflictExternalIds = builds.filter((build) => build.conflictsWithEdition).map((build) => build.row.external_id);
  if (conflictExternalIds.length) {
    const decisionNotes = "Auto-dismissed: the listing title is a multi-volume lot/set, names a different volume/printing/series, or conflicts with this edition's ISBN, publisher, language, or binding.";
    const { data: dismissed } = await admin
      .from("scout_listing_leads")
      .update({ review_status: "dismissed", review_notes: decisionNotes, reviewed_by: "RAR Auto-Triage" })
      .eq("profile_id", profileId)
      .in("external_id", conflictExternalIds)
      .eq("review_status", "new")
      .select("id");
    if (dismissed?.length) {
      await admin.from("scout_lead_decisions").insert(
        dismissed.map((row) => ({ lead_id: row.id, decision: "dismissed", decision_notes: decisionNotes, reviewed_by: "RAR Auto-Triage" })),
      );
    }
  }

  // Last, so the cap ranks the leads this scan just added alongside the ones
  // already there and the auto-dismissals above have already been applied.
  //
  // Returned rather than stored: a search that overflows every scan is worded
  // too broadly, and that is worth showing to whoever ran the scan. It does
  // not need a column of its own to say so.
  return capOpenLeads(admin, profileId);
}

return { buildCandidateFromListing, assessScoutListing, buildScoutLeadRow, OPEN_LEADS_PER_PROFILE, storeScoutLeads };
})();

return { assessScoutListing: __scoutIngest.assessScoutListing };})()