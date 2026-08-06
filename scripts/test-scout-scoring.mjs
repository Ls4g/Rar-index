// Standalone scoring sanity-check for the Scout match assessor. Run with:
//   node --experimental-strip-types scripts/test-scout-scoring.mjs
//
// Imports the real shipped scoring engine (lib/editionMatch.ts) and the real
// shipped listing-text helpers (lib/liveListings.ts) directly — Node's ESM
// resolver needs explicit file extensions for relative imports, which
// lib/scoutIngest.ts's TS-style extensionless imports don't have, so this
// script cannot import scoutIngest.ts itself. Instead it reproduces
// scoutIngest.ts's ~10-line assessScoutListing/buildCandidateFromListing
// glue (call order only, no scoring rule, weight, or regex is duplicated —
// every actual rule lives in the two live-imported modules below). If that
// glue ever drifts from lib/scoutIngest.ts, this script's own assertions
// are still checking the real scoring rules, just not the exact call shape.
//
// Per AGENTS.md: automation may only narrow what a human looks at. This
// script exists to prove the score/confidence bands are sensible BEFORE
// they are used as a default review filter — it does not change the rule
// that every lead, regardless of score, stays stored and staff-reviewable.

import { assessEditionMatch } from "../lib/editionMatch.ts";
import { detectFormatWord, extractListingSignals, hasMatchingVolume, listingIsMultiVolumeLot, listingNamesOtherVolume } from "../lib/liveListings.ts";

function buildCandidateFromListing(edition, listingTitle) {
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

function assessScoutListing(edition, listingTitle) {
  const candidate = buildCandidateFromListing(edition, listingTitle);
  const assessment = assessEditionMatch(edition, candidate);
  if (listingIsMultiVolumeLot(listingTitle, edition.volume_number)) {
    return { ...assessment, confidence: "conflict", conflicts: [...assessment.conflicts, "listing appears to be a multi-volume lot or set"] };
  }
  return assessment;
}

/** @typedef {{ title: string, series: string, volume_number: string, language: string, isbn_13: string, publisher: string, format?: string }} Edition */

const bleachVol1English = {
  title: "Bleach, Vol. 1: Strawberry and the Soul Reapers",
  series: "Bleach",
  volume_number: "1",
  language: "English",
  isbn_13: "9781591164418",
  publisher: "VIZ Media",
  format: "Paperback",
};

const kagurabachiVol1English = {
  title: "Kagurabachi, Vol. 1",
  series: "Kagurabachi",
  volume_number: "1",
  language: "English",
  isbn_13: "9781974747500",
  publisher: "VIZ Media",
  format: "Paperback",
};

const onePieceVol1Japanese = {
  title: "One Piece, Vol. 1",
  series: "One Piece",
  volume_number: "1",
  language: "Japanese",
  isbn_13: "9784088725093",
  publisher: "Shueisha",
  format: "Tankobon",
};

const hunterXHunterVol1English = {
  title: "Hunter x Hunter, Vol. 1",
  series: "Hunter x Hunter",
  volume_number: "1",
  language: "English",
  isbn_13: "9781591167532",
  publisher: "VIZ Media",
  format: "Paperback",
};

/** @type {Array<{ label: string, edition: Edition, listingTitle: string, expectBand: "strong" | "partial" | "insufficient" | "conflict", expectConflict?: boolean, note: string }>} */
const cases = [
  // --- Real titles pulled from RAR's live Scout data (2026-08-06 audit) ---
  {
    label: "real: no ISBN, series+volume only",
    edition: kagurabachiVol1English,
    listingTitle: "Kagurabachi, Vol. 1 Manga",
    expectBand: "partial",
    note: "Old scorer gave this 10/100 (insufficient) purely for lacking an ISBN. Series+volume alone should clear the 50+ review bar.",
  },
  {
    label: "real: no ISBN, series+volume+language+first-print wording",
    edition: hunterXHunterVol1English,
    listingTitle: "HunterxHunter Hunter x Hunter Volume 1 1st First Print Manga English Edition",
    expectBand: "partial",
    note: "30+20+15+5=70: comfortably clears the 50+ review bar (old scorer: 10/100, insufficient). Reaching 'strong' without publisher or ISBN corroboration would over-claim confidence from title text alone.",
  },
  {
    label: "real: multi-volume complete set (must stay a conflict)",
    edition: kagurabachiVol1English,
    listingTitle: "Kagurabachi Vol. 1-7 Complete Manga Set English",
    expectBand: "conflict",
    expectConflict: true,
    note: "A lot/set is never a single copy of one edition, regardless of how well the series name matches.",
  },
  {
    label: "real: no ISBN, exact series+volume title",
    edition: onePieceVol1Japanese,
    listingTitle: "One Piece, Vol. 1: Romance Dawn",
    expectBand: "partial",
    note: "Old scorer gave this 10/100. Should clear 50 on series+volume alone even with no language/ISBN stated.",
  },
  {
    label: "real: graded copy, right series/volume/language, no ISBN",
    edition: hunterXHunterVol1English,
    listingTitle: "Hunter x Hunter Volume 1 Manga First 1st Print English Edition 6.5 Graded",
    expectBand: "partial",
    note: "Series, volume, language, and first-print wording all line up (70/100) — a strong lift from the old scorer's 0/100 for this exact real listing, and clears the 50+ review bar.",
  },

  // --- Positive-signal coverage ---
  {
    label: "exact ISBN match with everything else",
    edition: bleachVol1English,
    listingTitle: "Bleach Vol 1 Manga English VIZ ISBN 9781591164418 Tite Kubo",
    expectBand: "strong",
    note: "Full match across every field should sit at the top of the strong band.",
  },
  {
    label: "series+volume+publisher, no ISBN or language",
    edition: bleachVol1English,
    listingTitle: "Bleach Vol. 1 VIZ Media Manga Book",
    expectBand: "partial",
    note: "30 (series) + 20 (volume) + 15 (publisher) = 65 -> partial; documents the real boundary rather than assuming.",
  },
  {
    label: "series+volume+language, no publisher/ISBN",
    edition: bleachVol1English,
    listingTitle: "Bleach Volume 1 English Manga Book",
    expectBand: "partial",
    note: "30 + 20 + 15 (language) = 65 -> partial, same shape as the publisher-only case above.",
  },
  {
    label: "series only, nothing else stated",
    edition: bleachVol1English,
    listingTitle: "Bleach Manga Book",
    expectBand: "insufficient",
    note: "Series name alone (no confirmed volume) is real but thin evidence — should stay below the 50+ review bar.",
  },

  // --- Conflict coverage (each must show as a distinct conflict) ---
  {
    label: "wrong volume named",
    edition: bleachVol1English,
    listingTitle: "Bleach Vol 8 English Manga VIZ",
    expectBand: "conflict",
    expectConflict: true,
    note: "Vol. 8 on a Vol. 1 profile is a plain, confident mismatch.",
  },
  {
    label: "wrong ISBN",
    edition: bleachVol1English,
    listingTitle: "Bleach Vol 1 Manga ISBN 9781234567897",
    expectBand: "conflict",
    expectConflict: true,
    note: "A different, well-formed ISBN-13 in the title is a hard conflict even with series/volume matching.",
  },
  {
    label: "wrong publisher named",
    edition: bleachVol1English,
    listingTitle: "Bleach Vol 1 Kodansha English Manga",
    expectBand: "conflict",
    expectConflict: true,
    note: "A named publisher that isn't this edition's own publisher is a confident mismatch (this edition is VIZ Media).",
  },
  {
    label: "wrong language named",
    edition: bleachVol1English,
    listingTitle: "Bleach Vol 1 Japanese Manga",
    expectBand: "conflict",
    expectConflict: true,
    note: "Japanese named on an English-edition profile is a real conflict.",
  },
  {
    label: "wrong binding named",
    edition: bleachVol1English,
    listingTitle: "Bleach Vol 1 Hardcover English Manga VIZ",
    expectBand: "conflict",
    expectConflict: true,
    note: "The edition is paperback; a hardcover listing is a binding conflict.",
  },
  {
    label: "real: multi-volume with '&' separator (not a dash range)",
    edition: bleachVol1English,
    listingTitle: "Bleach Manga Vol 1 Volume 1 & 2 English VIZ Rare",
    expectBand: "conflict",
    expectConflict: true,
    note: "A real Scout listing with this exact shape (different series) scored 80/100 strong before this fix — '&' between two volume numbers is just as unambiguous a lot/set signal as a dash range.",
  },
  {
    label: "lot/set wording without explicit volume range",
    edition: bleachVol1English,
    listingTitle: "Bleach Complete Collection Manga Lot English",
    expectBand: "conflict",
    expectConflict: true,
    note: "'Complete collection'/'lot' wording alone (no numeric range needed) still flags as a multi-volume lot.",
  },

  // --- Deliberately weak/ambiguous listings, to confirm they do NOT score high ---
  {
    label: "generic manga listing with no identifying text",
    edition: bleachVol1English,
    listingTitle: "Manga Book Bundle Anime Merchandise",
    expectBand: "insufficient",
    note: "No series name and no lot/set wording — must not accidentally score well, and must not be flagged as a conflict when there is simply nothing to go on.",
  },
];

let passed = 0;
let failed = 0;

console.log("Scout scoring sanity check\n" + "=".repeat(60));
for (const testCase of cases) {
  const assessment = assessScoutListing(testCase.edition, testCase.listingTitle);
  const bandOk = assessment.confidence === testCase.expectBand;
  const conflictOk = testCase.expectConflict ? assessment.conflicts.length > 0 : true;
  const ok = bandOk && conflictOk;
  passed += ok ? 1 : 0;
  failed += ok ? 0 : 1;

  console.log(`\n${ok ? "PASS" : "FAIL"}  ${testCase.label}`);
  console.log(`  listing: "${testCase.listingTitle}"`);
  console.log(`  score=${assessment.score}  confidence=${assessment.confidence}  (expected ${testCase.expectBand})`);
  if (assessment.reasons.length) console.log(`  reasons: ${assessment.reasons.join("; ")}`);
  if (assessment.conflicts.length) console.log(`  conflicts: ${assessment.conflicts.join("; ")}`);
  console.log(`  note: ${testCase.note}`);
}

console.log("\n" + "=".repeat(60));
console.log(`${passed}/${cases.length} cases matched the expected band${failed ? ` — ${failed} FAILED, review before shipping` : ""}.`);
if (failed) process.exitCode = 1;
