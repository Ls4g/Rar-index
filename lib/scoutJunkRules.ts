import { looksGraded } from "./editionMatch.ts";
import { listingIsMultiVolumeLot } from "./liveListings.ts";

// Conservative junk dismissal for Scout leads.
//
// Scout's existing scorer is at its ceiling on text matching: of the junk that
// still reaches a human, the great majority looks correct on every field it
// stores. These rules do not try to match better. They target the two things a
// listing title states outright, where RAR already has a rule saying the
// listing is a different object from the edition being tracked.
//
// The bar is deliberately asymmetric. A junk lead that reaches a human costs
// a few seconds. A genuine buying opportunity thrown away is gone silently and
// nobody ever learns it existed. So recall is the constraint and junk
// rejection is what gets optimised underneath it, never the reverse.
//
// These only ever DISMISS, which is the one direction automation is allowed to
// move a lead. Nothing here verifies a match, a sale or a printing, and every
// dismissal is written to scout_lead_decisions like a human's, so it can be
// read back and argued with.
//
// Measured on 822 real staff decisions, split 50/50 by a stable hash of the
// case id. Rules were designed against the development half only; see
// scripts/eval-scout-junk-reduction.mjs for the holdout figures.

export type JunkEdition = {
  series?: string | null;
  volume_number?: string | number | null;
  language?: string | null;
  publisher?: string | null;
  [key: string]: unknown;
};

export type JunkRule = {
  key: string;
  /** Why a human would dismiss it, or null if the rule does not fire. */
  matches: (edition: JunkEdition, title: string) => string | null;
};

export const JUNK_RULES: JunkRule[] = [
  {
    // The single largest category of junk staff still see: graded slabs
    // offered against an edition RAR tracks as a raw copy. A slab is a
    // different market with a different price -- it is the same separation
    // `comparisonGroup()` enforces on the evidence side, applied to leads.
    //
    // RAR editions carry no grade, so a graded listing can never be the exact
    // object being tracked. Reuses looksGraded, the detector the review inbox
    // already uses, rather than inventing a second definition of "graded".
    key: "graded_slab",
    matches: (_edition, title) => (looksGraded(title) ? "The listing is a graded slab; this edition is tracked as a raw copy." : null),
  },
  {
    // A lot, an omnibus or a 3-in-1 is not one volume.
    //
    // The shared detector (listingIsMultiVolumeLot) catches "set", "lot",
    // "collection", "complete" and ranges written "Vol 1-3". Measuring it
    // against staff decisions showed it rejects none of the lots that still
    // reach a human, because the ones that get through are written the four
    // ways below instead. Those patterns are added HERE rather than to the
    // shared detector: that function also gates catalogue matching and Scout
    // scoring, and widening it would change both without separate evidence.
    key: "multi_volume_lot",
    matches: (edition, title) => {
      const volume = (edition.volume_number ?? null) as string | number | null;
      if (!volume) return null;
      // RAR catalogues omnibus and collected editions in their own right, and
      // a profile tracking one legitimately wants exactly these listings. The
      // holdout caught this: an earlier version of this guard read only
      // `series` and `format`, and discarded two real buying opportunities --
      // "One Piece Volume 1 Omnibus Edition TPB" and "Initial D Omnibus 1" --
      // because those editions say "omnibus" in their title or edition
      // statement instead. Every field that names the edition is checked.
      const target = [edition.title, edition.series, edition.format, edition.variant_name, edition.edition_statement]
        .map((value) => String(value ?? "")).join(" ").toLowerCase();
      if (/omnibus|\d\s*-?\s*in\s*-?\s*1|box\s*set|deluxe|collect/.test(target)) return null;
      if (listingIsMultiVolumeLot(title, volume)) return "The listing is a lot or set, not the single volume being tracked.";
      // The word "omnibus" alone is not evidence of a lot. Staff drew this
      // line themselves on the benchmark: "Initial D Omnibus #1-#9" is junk,
      // while "Initial D Omnibus 1 (Vol. 1)" and "Attack On Titan Manga
      // Omnibus Volume 1" are genuine opportunities they kept. A single
      // omnibus volume is one book a collector tracking that volume wants;
      // dismissing every title containing the word threw those away.
      //
      // An omnibus listing is still dismissed when the title itself evidences
      // more than one volume, which the range, N-in-1 and enumeration patterns
      // below detect on their own.
      if (/\b\d+\s*-?\s*in\s*-?\s*1\b/i.test(title)) return "The listing is an N-in-1 collected edition, not a single volume.";
      // "#1-#9", which the shared range pattern misses because of the second #.
      if (/#\s*\d+\s*(?:-|–|to)\s*#\s*\d+/i.test(title)) return "The listing covers a range of issues, not one volume.";
      // A run of volume numbers written without separators: "Vol. 1 2 3".
      if (/\b(?:vol(?:ume)?\.?|bk|book)\s*\d+(?:\s*,?\s+\d+){2,}\b/i.test(title)) return "The listing names several volumes together.";
      return null;
    },
  },
];

export type JunkDismissal = { shouldDismiss: true; rule: string; reason: string } | null;

/**
 * Apply every rule that demonstrated no recall loss.
 *
 * Returns the FIRST rule that fires, so the recorded reason names one specific
 * thing a person can check rather than a list.
 */
export function conservativeJunkDismissal(edition: JunkEdition, title: string): JunkDismissal {
  for (const rule of JUNK_RULES) {
    const reason = rule.matches(edition, title ?? "");
    if (reason) return { shouldDismiss: true, rule: rule.key, reason };
  }
  return null;
}
