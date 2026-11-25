/**
 * Turns what a collector types into the add-to-portfolio box into a search.
 *
 * The old search matched the whole text as one phrase, so "Naruto 5",
 * "naruto vol 5" or "One Piece volume 3" found nothing (records are titled
 * "Naruto, Vol. 5"), and "Naruto" alone returned eight arbitrary volumes.
 * Now an ISBN is matched as an ISBN, a volume number is matched against the
 * volume field, and every remaining word must appear in the title or series.
 */
export type EditionSearchQuery = {
  isbn: string | null;
  volume: string | null;
  words: string[];
};

const FILLER = new Set(["vol", "volume", "volumes", "manga", "the", "edition", "book", "no"]);

export function parseEditionSearch(input: string): EditionSearchQuery {
  const text = input.trim();
  const digits = text.replace(/[\s-]/g, "");
  if (/^(?:97[89])?\d{9}[\dXx]$/.test(digits)) return { isbn: digits.toUpperCase(), volume: null, words: [] };

  let rest = ` ${text} `;
  let volume: string | null = null;
  const marked = rest.match(/(?:\bvol(?:ume)?\.?|\bv\.?|#|\bno\.)\s*(\d{1,3})\b/i);
  if (marked) {
    volume = String(Number(marked[1]));
    rest = rest.replace(marked[0], " ");
  } else {
    // A bare number at the end ("Naruto 5"), but only after some words, so a
    // title that is just a number is still searched as text.
    const trailing = rest.match(/^(.*\S)\s+(\d{1,3})\s*$/);
    if (trailing && /[a-z]/i.test(trailing[1])) {
      volume = String(Number(trailing[2]));
      rest = trailing[1];
    }
  }
  const words = rest
    .toLowerCase()
    // Only letters, digits and hyphens survive: the words go straight into a
    // PostgREST filter, where commas, dots, brackets and wildcards mean syntax.
    .replace(/[^\p{L}\p{N}-]+/gu, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !FILLER.has(word))
    .slice(0, 5);
  return { isbn: null, volume, words };
}

/** Numeric-aware order for volume numbers stored as text. */
export function compareVolumes(left: string | null, right: string | null) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) return a - b;
  if (Number.isFinite(a)) return -1;
  if (Number.isFinite(b)) return 1;
  return (left ?? "").localeCompare(right ?? "");
}
