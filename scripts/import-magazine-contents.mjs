// Fills in what a catalogued magazine issue actually contains, from the Media
// Arts Database. Touches only magazines already approved into the catalogue --
// it never creates or approves an edition.
//
// This is the piece that lets a magazine record explain itself. A 1984 Jump is
// worth a few pounds; the one carrying chapter 1 of Dragon Ball is not, and the
// only difference is the contents.
//
// Usage:
//   node scripts/import-magazine-contents.mjs           # dry run
//   node scripts/import-magazine-contents.mjs --write
import fs from "node:fs";

const ENDPOINT = "https://mediaarts-db.artmuseums.go.jp/sparql";
const P = "https://mediaarts-db.artmuseums.go.jp/data/property#";
const WRITE = process.argv.includes("--write");

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

async function sq(query) {
  const r = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, { headers: { Accept: "application/sparql-results+json" } });
  if (!r.ok) throw new Error(`SPARQL ${r.status}`);
  return (await r.json()).results.bindings;
}
async function rest(method, path, body) {
  const r = await fetch(`${SUPABASE}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no body */ }
  return { ok: r.ok, status: r.status, json, text };
}

// The source's genre vocabulary has fifteen values. Only three distinctions
// matter to a collector: the cover feature, a serialised chapter, and
// everything else the magazine printed.
function contentKind(genre) {
  if (genre === "表紙") return "cover";
  if (genre === "マンガ作品") return "story";
  return "feature";
}

const editions = await rest("GET", "manga_editions?select=id,volume_number,madb_id,magazine_title_id,release_date&collectible_type=eq.zasshi&madb_id=not.is.null");
if (!editions.ok) throw new Error(editions.text);
const issues = editions.json ?? [];
console.log(`${issues.length} catalogued magazine issue${issues.length === 1 ? "" : "s"} with a source record.\n`);

for (const issue of issues) {
  const subject = `https://mediaarts-db.artmuseums.go.jp/id/${issue.madb_id}`;
  const rows = await sq(`SELECT ?part ?name ?creator ?genre ?note ?ps ?pe WHERE {
    <${subject}> <https://schema.org/hasPart> ?part .
    ?part <https://schema.org/name> ?name .
    OPTIONAL { ?part <https://schema.org/creator> ?creator }
    OPTIONAL { ?part <https://schema.org/genre> ?genre }
    OPTIONAL { ?part <${P}note> ?note }
    OPTIONAL { ?part <${P}pageStart> ?ps }
    OPTIONAL { ?part <${P}pageEnd> ?pe }
  }`);

  // creator is recorded twice, in kanji and in katakana, which doubles every
  // row. Fold on the part id and keep the kanji reading -- the one a seller or
  // a collector would recognise.
  const byPart = new Map();
  for (const row of rows) {
    const id = row.part.value.split("/").pop();
    const existing = byPart.get(id);
    const creator = row.creator?.value ?? null;
    if (!existing) {
      byPart.set(id, {
        madb_part_id: id,
        work_title: row.name.value,
        creator,
        content_kind: contentKind(row.genre?.value),
        colour_note: row.note?.value ?? null,
        page_start: row.ps ? Number(row.ps.value) : null,
        page_end: row.pe ? Number(row.pe.value) : null,
      });
    } else if (creator && /[一-鿿぀-ゟ]/.test(creator) && !/[一-鿿]/.test(existing.creator ?? "")) {
      existing.creator = creator;
    }
  }

  // A work's first appearance in this magazine is its debut. Left-censoring is
  // handled where it is derived at import time (see
  // import-madb-magazine-issues.mjs); here it is only asked for issues that
  // sit well inside the covered range, so a series already running before the
  // data begins cannot be claimed as a debut.
  const debuts = new Set();
  for (const part of byPart.values()) {
    if (part.content_kind === "feature") continue;
    const first = await sq(`SELECT (MIN(?d) AS ?first) WHERE {
      ?issue <https://schema.org/isPartOf> <https://mediaarts-db.artmuseums.go.jp/id/C119459> ;
             <https://schema.org/datePublished> ?d ; <https://schema.org/hasPart> ?p .
      ?p <https://schema.org/name> ?pn . FILTER(?pn = ${JSON.stringify(part.work_title)})
    }`);
    const firstDate = first[0]?.first?.value;
    if (firstDate && firstDate === issue.release_date && firstDate > "1971-01-01") debuts.add(part.madb_part_id);
  }

  const parts = [...byPart.values()]
    .sort((a, b) => (a.page_start ?? 9999) - (b.page_start ?? 9999))
    .map((part, index) => ({
      ...part,
      edition_id: issue.id,
      is_first_appearance: debuts.has(part.madb_part_id),
      display_order: index,
      source_url: `${ENDPOINT}?query=${encodeURIComponent(`DESCRIBE <${subject}>`)}`,
      updated_at: new Date().toISOString(),
    }));

  console.log(`${issue.volume_number} — ${parts.length} entries${debuts.size ? `, ${debuts.size} first appearance${debuts.size === 1 ? "" : "s"}` : ""}`);
  for (const part of parts.slice(0, 6)) {
    console.log(`   ${part.is_first_appearance ? "★" : " "} ${part.content_kind.padEnd(7)} ${part.work_title.slice(0, 30).padEnd(32)} ${(part.creator ?? "").slice(0, 16)}`);
  }
  if (parts.length > 6) console.log(`     …and ${parts.length - 6} more`);

  if (WRITE && parts.length) {
    const res = await rest("POST", "magazine_issue_contents?on_conflict=edition_id,madb_part_id", parts);
    console.log(res.ok ? `   stored ${parts.length}` : `   FAILED ${res.text.slice(0, 160)}`);
  }
  console.log("");
}

if (!WRITE) console.log("Dry run — nothing written. Re-run with --write.");
