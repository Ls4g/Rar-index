// One series, one spelling.
//
//   node --env-file=.env.local scripts/normalise-series-spelling.mjs [--commit]
//
// Without --commit this writes nothing and prints what it would change.
//
// RAR stores a series under whatever string was typed when the edition was
// added, so "One Piece" and "ONE PIECE" were two series as far as any grouping
// was concerned. A filter matching exactly would have shown 26 of the 28 One
// Piece volumes and looked complete doing it.
//
// The convention is already visible in the data and is not invented here: a
// Japanese edition carries the title-case common name in `series` -- Bleach,
// Naruto, Attack on Titan, Initial D, and one of the two One Piece rows -- and
// keeps the publisher's own styling in `title` ("ONE PIECE 1"). The rows fixed
// here are the ones that put the styling in `series` instead.
//
// `title` is never touched. "SPY×FAMILY 1" is what that book is called and is
// not a mistake.
//
// Matching is unaffected either way: assessEditionMatch compares series through
// compact(), which lowercases and strips punctuation, so this changes how the
// catalogue groups and reads, not what Scout matches.
import { createClient } from "@supabase/supabase-js";

const commit = process.argv.includes("--commit");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await admin.from("manga_editions").select("id,series,title,language,publisher");
if (error) throw new Error(`Could not read editions: ${error.message}`);

const groups = new Map();
for (const edition of data) {
  const key = (edition.series ?? "").trim().toLowerCase();
  if (!key) continue;
  groups.set(key, [...(groups.get(key) ?? []), edition]);
}

/**
 * The spelling to keep.
 *
 * Most-used wins, because 26 rows against 2 is the catalogue telling you what
 * it calls the series. A tie is broken towards the spelling that is not
 * all-capitals, which is the convention every other series already follows;
 * an all-caps tie falls back to alphabetical so the choice is never arbitrary.
 */
function canonicalSpelling(editions) {
  const counts = new Map();
  for (const edition of editions) {
    const spelling = (edition.series ?? "").trim();
    counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    const leftShouty = left[0] === left[0].toUpperCase();
    const rightShouty = right[0] === right[0].toUpperCase();
    if (leftShouty !== rightShouty) return leftShouty ? 1 : -1;
    return left[0].localeCompare(right[0]);
  })[0][0];
}

const changes = [];
for (const [, editions] of groups) {
  const spellings = new Set(editions.map((edition) => (edition.series ?? "").trim()));
  if (spellings.size < 2) continue;
  const keep = canonicalSpelling(editions);
  for (const edition of editions) {
    if ((edition.series ?? "").trim() === keep) continue;
    changes.push({ id: edition.id, from: edition.series, to: keep, title: edition.title, language: edition.language });
  }
}

console.log(`${commit ? "COMMIT" : "DRY RUN"} — ${groups.size} distinct series, ${changes.length} row(s) to normalise\n`);
for (const change of changes) {
  console.log(`  "${change.from}" -> "${change.to}"`);
  console.log(`     ${change.language ?? "?"} · title stays "${change.title}"`);
}
if (!changes.length) {
  console.log("Every series already has exactly one spelling.");
  process.exit(0);
}
if (!commit) {
  console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
  process.exit(0);
}

let updated = 0;
for (const change of changes) {
  const { error: updateError } = await admin.from("manga_editions")
    .update({ series: change.to })
    .eq("id", change.id)
    .eq("series", change.from);
  if (updateError) throw new Error(`Failed on ${change.id}: ${updateError.message}`);
  updated += 1;
}
console.log(`\nupdated ${updated} row(s).`);
