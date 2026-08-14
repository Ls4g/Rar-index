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

export type IssueReference = {
  year: number | null;
  // Every issue number the listing names. A 合併号 (combined issue) is printed
  // as "4・5" and sold under either half, so both are kept.
  issueNumbers: number[];
  cumulative: number | null;
  // What the listing looked like. A listing shaped like a book is not a
  // magazine no matter what numbers it contains.
  looksLikeBook: boolean;
};

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

function toHalfWidth(value: string) {
  return value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

export function splitIssueNumbers(raw: string): number[] {
  return toHalfWidth(raw)
    .split(/[・･,、\-–/&\s]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 99);
}

export function parseIssueReference(listingTitle: string | null | undefined): IssueReference {
  const title = String(listingTitle ?? "");
  const looksLikeBook = BOOK_SHAPE.test(title);

  const cumulativeMatch = title.match(JA_CUMULATIVE);
  const cumulative = cumulativeMatch ? Number(cumulativeMatch[1]) : null;

  let year: number | null = null;
  let issueNumbers: number[] = [];

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
export function namesAnIssue(reference: IssueReference) {
  if (reference.cumulative !== null) return true;
  return reference.issueNumbers.length > 0 && reference.year !== null;
}

// A slabbed copy is sealed in plastic behind a grader's label, so it is a
// poorer look at a magazine than a loose copy: part of the cover is covered
// and the rest is behind perspex. Used to prefer raw copies when picking a
// photograph, and to pick graded leads out of the Scout queue.
const GRADED_TITLE = /\b(cgc|cbcs|bgs|beckett|psa|graded|slab(bed)?)\b/i;

export function looksGraded(title: string | null | undefined) {
  return GRADED_TITLE.test(String(title ?? ""));
}

export type ZasshiTarget = {
  issue_year: number | null;
  issue_number_label: string | null;
  cumulative_issue_no: number | null;
};

export type ZasshiAssessment = {
  // Mirrors the ISBN weighting in assessEditionMatch: an exact identity match
  // is the strongest signal available for a record that has no ISBN.
  score: number;
  reasons: string[];
  conflicts: string[];
};

export function assessIssueMatch(target: ZasshiTarget, listingTitle: string | null | undefined): ZasshiAssessment {
  const reference = parseIssueReference(listingTitle);
  const reasons: string[] = [];
  const conflicts: string[] = [];
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

export type EditionMatchTarget = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher?: string | null;
  format?: string | null;
  // Set on magazine issues. A zasshi has no ISBN and no volume number, so its
  // identity is the magazine plus the year and issue number -- see the issue
  // parser at the top of this file and docs/zasshi-model.md.
  collectible_type?: string | null;
  issue_year?: number | null;
  issue_number_label?: string | null;
  cumulative_issue_no?: number | null;
  printing_number?: number | null;
  edition_statement?: string | null;
  variant_name?: string | null;
};

export type EditionMatchCandidate = {
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  format?: string | null;
};

export type EditionMatchAssessment = {
  score: number;
  confidence: "strong" | "partial" | "insufficient" | "conflict";
  reasons: string[];
  conflicts: string[];
};

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
function normalise(value: string | number | null | undefined) {
  return String(value ?? "")
    .toLowerCase()
    .replace(CROSS_CHARACTERS, "x")
    .replace(/[^a-z0-9぀-ヿ㐀-䶿一-鿿]/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Some catalogue records carry no separate series and a title that already
// embeds the volume ("ONE PIECE 1"). Used whole, that needle asks listings
// to contain "onepiece1", which "ONE PIECE Vol.1 1997..." never does. Drop
// the trailing volume token -- but only when it is this edition's own
// volume number, so a title that genuinely ends in a number is left alone.
function seriesNeedle(target: EditionMatchTarget) {
  if (target.series) return target.series;
  const title = (target.title ?? "").trim();
  const volume = target.volume_number === null || target.volume_number === undefined ? "" : String(target.volume_number).trim();
  if (!title || !volume) return title;
  const trailingVolume = new RegExp(`[,\\s]*(?:vol(?:ume)?\\.?\\s*)?#?\\s*${escapeRegExp(volume)}\\s*$`, "i");
  const stripped = title.replace(trailingVolume, "").trim();
  return stripped.length >= 3 ? stripped : title;
}

function normaliseIsbn(value: string | null | undefined) {
  return String(value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function titleMatches(left: string | null, right: string | null) {
  const a = normalise(left);
  const b = normalise(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

// A listing title containing the series/title name as a plain substring is
// far more common in real eBay titles than the whole (often subtitled)
// edition title appearing verbatim — "Bleach Vol 1 Manga English VIZ" should
// read as a series match against "Bleach", not fail because it doesn't also
// say "Strawberry and the Soul Reapers".
function containsNormalised(haystack: string | null, needle: string | null) {
  const h = normalise(haystack);
  const n = normalise(needle);
  return Boolean(h && n && n.length >= 3 && h.includes(n));
}

function formatCategory(value: string | null | undefined): "hardcover" | "paperback" | null {
  const normalized = (value ?? "").toLocaleLowerCase();
  if (!normalized) return null;
  if (/hard\s*cover|hardback|cased/.test(normalized)) return "hardcover";
  if (/paper\s*back|soft\s*cover|trade\s*paperback|tank[oō]bon/.test(normalized)) return "paperback";
  return null;
}

const FIRST_PRINTING_WORDS = /\b(?:1st|first)\s*print(?:ing)?\b|\bfirst\s*edition\b/i;
const NUMBERED_PRINTING = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:print(?:ing)?|impression)\b/i;
const WORD_PRINTINGS: Record<string, number> = {
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

export function explicitPrintingNumber(value: string | null | undefined) {
  const text = String(value ?? "");
  const numbered = text.match(NUMBERED_PRINTING);
  if (numbered) return Number(numbered[1]);
  const word = text.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s*(?:print(?:ing)?|impression)\b/i);
  return word ? WORD_PRINTINGS[word[1].toLowerCase()] : null;
}

const SERIES_FAMILY_EXTENSIONS: Record<string, string[]> = {
  dragonball: ["dragonballz", "dragonballsuper", "dragonballgt"],
};

function seriesFamilyConflict(targetSeries: string | null, listingTitle: string | null) {
  const target = normalise(targetSeries);
  const listing = normalise(listingTitle);
  return Boolean(target && listing && (SERIES_FAMILY_EXTENSIONS[target] ?? []).some((variant) => listing.includes(variant)));
}

// Weighted for how often each field is actually present in real listing
// text: a clear series/volume match is common and meaningful even with no
// ISBN, so it carries the most weight. ISBN is still valuable when present,
// but no longer dominant enough that its absence caps every otherwise-solid
// match at "insufficient" (see AGENTS.md — most eBay titles omit it).
export function assessEditionMatch(target: EditionMatchTarget, candidate: EditionMatchCandidate): EditionMatchAssessment {
  let score = 0;
  const reasons: string[] = [];
  const conflicts: string[] = [];
  const isZasshi = target.collectible_type === "zasshi";

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
    reasons.push(...issue.reasons);
    conflicts.push(...issue.conflicts);
  } else {
    const targetVolume = normalise(target.volume_number);
    const candidateVolume = normalise(candidate.volume_number);
    if (targetVolume && candidateVolume) {
      if (targetVolume === candidateVolume) {
        score += 20;
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
    if (targetPublisher === candidatePublisher) {
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

  score = Math.min(100, score);
  const confidence: EditionMatchAssessment["confidence"] = conflicts.length
    ? "conflict"
    : score >= 75 ? "strong"
      : score >= 50 ? "partial"
        : "insufficient";
  return { score, confidence, reasons, conflicts };
}
