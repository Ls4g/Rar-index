export type EditionMatchTarget = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher?: string | null;
  format?: string | null;
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

function normalise(value: string | number | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
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

// Weighted for how often each field is actually present in real listing
// text: a clear series/volume match is common and meaningful even with no
// ISBN, so it carries the most weight. ISBN is still valuable when present,
// but no longer dominant enough that its absence caps every otherwise-solid
// match at "insufficient" (see AGENTS.md — most eBay titles omit it).
export function assessEditionMatch(target: EditionMatchTarget, candidate: EditionMatchCandidate): EditionMatchAssessment {
  let score = 0;
  const reasons: string[] = [];
  const conflicts: string[] = [];

  const targetSeriesName = target.series || target.title;
  const seriesOrTitleMatches = titleMatches(target.title, candidate.title)
    || titleMatches(target.series, candidate.series)
    || containsNormalised(candidate.title, targetSeriesName);
  if (seriesOrTitleMatches) {
    score += 30;
    reasons.push("series/title matches");
  } else {
    reasons.push("series/title needs human inspection");
  }

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

  const targetFormat = formatCategory(target.format);
  const candidateFormat = formatCategory(candidate.format);
  if (targetFormat && candidateFormat && targetFormat !== candidateFormat) {
    conflicts.push("binding/format conflicts with the selected edition");
  }

  if (candidate.title && FIRST_PRINTING_WORDS.test(candidate.title)) {
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
