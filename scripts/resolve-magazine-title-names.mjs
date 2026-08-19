// Finds a readable name for each Japanese work title in a magazine's contents.
//
// English first, romanised Japanese second. The page exists so a reader does
// not have to decode a Japanese title themselves, so the recognisable name
// wins. Where neither exists this writes nothing and the Japanese title stands
// alone rather than being guessed at.
//
// Source: MangaDex, already registered in RAR's sources at community trust.
// Nothing here is evidence and nothing affects a price; it is a display name.
//
// Usage:
//   node scripts/resolve-magazine-title-names.mjs           # dry run
//   node scripts/resolve-magazine-title-names.mjs --write
import fs from "node:fs";

const WRITE = process.argv.includes("--write");
for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

// Full-width spaces are how the source writes "DRAGON　BALL". They render as a
// visible gap and break any comparison against a normal title.
export function tidyTitle(value) {
  return String(value ?? "").replace(/[　\s]+/g, " ").trim();
}

// A serialisation part number belongs to the issue, not the work, so it is
// removed before searching and put back afterwards.
function splitPartSuffix(title) {
  const match = tidyTitle(title).match(/^(.*?)(\s*PART\s*\d+)$/i);
  return match ? { base: match[1].trim(), suffix: match[2].trim() } : { base: tidyTitle(title), suffix: "" };
}

function normalise(value) {
  return String(value ?? "").toLowerCase().replace(/[\s　・･!！?？:：\-–—.,'’"]/g, "");
}

// Latin already. No lookup needed, and no risk of a lookup returning something
// worse than what the source printed.
function isAlreadyLatin(value) {
  return !/[぀-ヿ一-鿿]/.test(value);
}

function pick(attributes, key) {
  if (!attributes) return null;
  return attributes.title?.[key] ?? (attributes.altTitles ?? []).map((entry) => entry[key]).find(Boolean) ?? null;
}

// "Kimagure Orange Road (Official Colored)" is an edition of the work, not its
// name. Anything parenthetical is a qualifier and is dropped.
function stripQualifier(value) {
  return String(value ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

// Several titles carry their own Latin form beside the Japanese, because the
// publisher printed both: "シェイプアップ乱 SHAPE UP RAN", "WING-MAN ウィングマン".
// That is the English name straight from the source, so it needs no lookup and
// cannot be wrong.
function latinPortion(value) {
  const runs = String(value ?? "").match(/[A-Za-z][A-Za-z0-9'’&.\-! ]{2,}/g) ?? [];
  // A Latin run has to look like a title rather than a fragment of one:
  // "ガクエン情報部HIP" ends in "HIP", which is part of the name and not the
  // name. Multi-word, or long enough to stand on its own.
  const best = runs
    .map((run) => run.trim())
    .filter((run) => run.includes(" ") || run.replace(/[^A-Za-z]/g, "").length >= 6)
    .sort((a, b) => b.length - a.length)[0];
  return best ?? null;
}

async function resolve(workTitle) {
  const { base, suffix } = splitPartSuffix(workTitle);
  if (isAlreadyLatin(base)) return { name: [base, suffix].filter(Boolean).join(" "), source: "source record" };

  const printed = latinPortion(base);
  if (printed) return { name: [printed, suffix].filter(Boolean).join(" "), source: "source record (printed Latin title)" };

  const url = `https://api.mangadex.org/manga?title=${encodeURIComponent(base)}&limit=6&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`;
  const response = await fetch(url);
  if (!response.ok) return { name: null, source: null };
  const payload = await response.json();

  // Only an exact title match counts. A fuzzy one produces a confident,
  // wrong name on a page nobody would think to double-check.
  for (const entry of payload.data ?? []) {
    const attributes = entry.attributes;
    const every = [...Object.values(attributes.title ?? {}), ...(attributes.altTitles ?? []).flatMap((alt) => Object.values(alt))];
    if (!every.some((value) => normalise(value) === normalise(base))) continue;
    const english = stripQualifier(pick(attributes, "en"));
    const romaji = stripQualifier(pick(attributes, "ja-ro") ?? pick(attributes, "ja_ro"));
    // English wins. The whole point of the column is that a reader should not
    // have to decode the title themselves, so the name they would recognise
    // beats the one a seller types. Romanisation is only the fallback.
    const chosen = english || romaji;
    if (!chosen) continue;
    return { name: [chosen, suffix].filter(Boolean).join(" "), source: english ? "MangaDex (English)" : "MangaDex (romanised)" };
  }
  return { name: null, source: null };
}

const rows = await (await fetch(`${SUPABASE}/rest/v1/magazine_issue_contents?select=id,work_title,work_title_en&order=display_order`, { headers: H })).json();
console.log(`${rows.length} content entries.\n`);

const cache = new Map();
let resolved = 0;
let unresolved = 0;
for (const row of rows) {
  const key = tidyTitle(row.work_title);
  if (!cache.has(key)) { cache.set(key, await resolve(row.work_title)); await new Promise((r) => setTimeout(r, 220)); }
  const { name, source } = cache.get(key);
  if (name && name !== key) resolved += 1; else if (!name) unresolved += 1;
  console.log(`  ${key.slice(0, 26).padEnd(28)} -> ${name ?? "(kept in Japanese)"}`);
  if (WRITE) {
    await fetch(`${SUPABASE}/rest/v1/magazine_issue_contents?id=eq.${row.id}`, {
      method: "PATCH",
      headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify({ work_title_en: name, work_title_source: source }),
    });
  }
}

console.log(`\n${resolved} given a readable name, ${unresolved} kept in Japanese.`);
if (!WRITE) console.log("Dry run — nothing written. Re-run with --write.");
