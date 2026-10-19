// A named variant must be separable from the plain edition that shares its ISBN.
//
//   node --experimental-strip-types scripts/test-edition-variant-match.mjs
//
// Three of RAR's ISBNs carry two editions each, because a later printing or a
// cover variant keeps the ISBN of the first. When a sold listing comes back
// from a search by that ISBN, the title is the only thing that can say which
// of the two it is. Before this existed both scored identically, so a listing
// that said "Gold Foil cover" in plain English was handed to a person as
// undecidable.
//
// Every assertion here is about a RELATIONSHIP -- higher than, equal to,
// capped at -- never an exact score. Weights move as the scorer is tuned, and
// a test pinned to a literal breaks on contact without catching a single real
// regression. What must hold is the ordering.
import assert from "node:assert/strict";
import { assessEditionMatch } from "../lib/editionMatch.ts";

const PLAIN = {
  title: "One Piece, Vol. 1",
  series: "One Piece",
  volume_number: "1",
  language: "English",
  isbn_13: "9781569319017",
  publisher: "VIZ Media",
  format: "Paperback",
  printing_number: null,
  edition_statement: "VIZ Media English paperback edition",
  variant_name: null,
  collectible_type: "tankobon",
};

// Same ISBN, same volume, same publisher. The variant name is the only
// difference, which is exactly the problem.
const GOLD_FOIL = { ...PLAIN, printing_number: 9, edition_statement: "Gold Foil 9th printing (candidate)", variant_name: "Gold Foil" };

// A variant_name that is a sentence rather than a tag. It can never appear
// verbatim in a listing title, and matching it loosely would let its "first
// printing" fragment fire on every first-printing listing in existence.
const DESCRIPTIVE = {
  ...PLAIN,
  isbn_13: "9784088725093",
  language: "Japanese",
  printing_number: 1,
  edition_statement: "1997 first printing (verified)",
  variant_name: "1997 first printing (verified)",
};

const candidate = (title) => ({ title, series: null, volume_number: "1", language: null, isbn_13: null, publisher: null });

const checks = [];
function check(label, fn) {
  try {
    fn();
    checks.push({ label, ok: true });
  } catch (error) {
    checks.push({ label, ok: false, error: error.message });
  }
}

check("a title naming the variant scores higher for the variant than for the plain edition", () => {
  const title = candidate("One Piece Manga vol. 1 - Gold Foil cover, Used, Acceptable Condition");
  const foil = assessEditionMatch(GOLD_FOIL, title);
  const plain = assessEditionMatch(PLAIN, title);
  assert.ok(
    foil.score > plain.score,
    `expected the Gold Foil edition to outscore the plain one; got foil=${foil.score} plain=${plain.score}`,
  );
  assert.ok(
    foil.reasons.some((reason) => reason.includes("Gold Foil")),
    `expected a reason naming the variant; got ${JSON.stringify(foil.reasons)}`,
  );
});

check("a title that says nothing about the variant stays a tie, so a person still decides", () => {
  const title = candidate("One Piece, Vol. 1");
  const foil = assessEditionMatch(GOLD_FOIL, title);
  const plain = assessEditionMatch(PLAIN, title);
  assert.equal(
    foil.score,
    plain.score,
    `a silent title must not favour either edition; got foil=${foil.score} plain=${plain.score}`,
  );
});

check("naming the variant is never a conflict for the plain edition", () => {
  const title = candidate("One Piece Manga vol. 1 - Gold Foil cover");
  const plain = assessEditionMatch(PLAIN, title);
  assert.deepEqual(
    plain.conflicts,
    [],
    `the plain edition must not be ruled out by a word belonging to a sibling; got ${JSON.stringify(plain.conflicts)}`,
  );
});

check("a descriptive variant_name is not matched loosely", () => {
  // This title states a first printing, which is genuinely true of the target
  // and is already credited by the printing rule. What must NOT happen is the
  // variant rule also firing because the words "first printing" appear inside
  // a variant_name that reads "1997 first printing (verified)".
  const title = candidate("ONE PIECE 1 Jump Comics first printing Japanese");
  const assessment = assessEditionMatch(DESCRIPTIVE, title);
  assert.ok(
    !assessment.reasons.some((reason) => reason.includes("variant")),
    `a sentence-shaped variant_name must not be pattern-matched; got ${JSON.stringify(assessment.reasons)}`,
  );
});

check("naming the variant cannot lift a listing that never established the volume", () => {
  // No volume anywhere in the title, so the scorer caps it: naming a cover
  // finish says nothing about WHICH copy this is, and must not buy a way past
  // the identity cap.
  const title = { title: "One Piece Gold Foil cover manga", series: null, volume_number: null, language: null, isbn_13: null, publisher: null };
  const assessment = assessEditionMatch(GOLD_FOIL, title);
  assert.ok(
    assessment.score < 50,
    `an unidentified copy must stay below the partial band; got ${assessment.score} (${assessment.confidence})`,
  );
});

check("an edition with no variant_name is unaffected", () => {
  const title = candidate("One Piece, Vol. 1 VIZ Media English paperback");
  const before = assessEditionMatch({ ...PLAIN, variant_name: null }, title);
  const alsoBefore = assessEditionMatch({ ...PLAIN }, title);
  assert.equal(before.score, alsoBefore.score, "a null variant_name must be a no-op");
  assert.ok(
    !before.reasons.some((reason) => reason.includes("variant")),
    `no variant reason should appear; got ${JSON.stringify(before.reasons)}`,
  );
});

for (const result of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}`);
  if (!result.ok) console.log(`      ${result.error}`);
}
const failed = checks.filter((result) => !result.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
