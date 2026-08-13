// Pulls magazine issues from Japan's Media Arts Database into
// catalogue_import_queue for human review. Approves nothing, ever -- every
// candidate still goes through apply_catalogue_review like any other source.
//
// Source: https://mediaarts-db.artmuseums.go.jp/ (National Center for Art
// Research). Terms permit commercial use with attribution; cover images are
// excluded and still come through cover_candidates.
//
// The source data is good but not clean, and this script is mostly the
// checking. Measured against all 2,388 Weekly Shonen Jump issues on
// 12 Aug 2026:
//
//   - 通巻 is 100% populated but NOT reliable. Five values are transcription
//     errors, two of them badly wrong: 2000年52号 is recorded as 通巻52 (the
//     issue number typed into the 通巻 field) and 1998年12号 as 通巻485. Both
//     would have been imported as fact. Anything whose 通巻 drifts far from
//     its date-ordered position is withheld for a human instead.
//   - Two records are not issues at all: a flip-book cover recorded twice
//     (2012年18号) and a bound-in supplement given its own issue record
//     (2012年36号). Both are withheld.
//   - Coverage runs 1969-11-03 to 2018-06-25. The magazine started in 1968
//     and is still running, so roughly the first 35 and everything after
//     June 2018 is absent. Not a bug to fix here -- a gap to state.
//   - 新連載 (new serial) markers exist on only 7 parts in the whole run, so
//     debuts cannot be read off a flag. They are derived instead from the
//     earliest issue in which a work appears, which reproduces the known
//     debuts exactly: One Piece 1997年34号, Hunter x Hunter 1998年14号,
//     Naruto 1999年43号, Bleach 2001年36号.
//
// Usage:
//   node scripts/import-madb-magazine-issues.mjs                  # dry run, all
//   node scripts/import-madb-magazine-issues.mjs --year 1997      # dry run, one year
//   node scripts/import-madb-magazine-issues.mjs --debuts         # only issues carrying a first appearance
//   node scripts/import-madb-magazine-issues.mjs --year 1997 --write
import fs from "node:fs";

const ENDPOINT = "https://mediaarts-db.artmuseums.go.jp/sparql";
const P = "https://mediaarts-db.artmuseums.go.jp/data/property#";
const SOURCE_NAME = "Media Arts Database";

// Weekly Shonen Jump. Other magazines get added here as they are catalogued.
const MAGAZINE = {
  madbId: "C119459",
  nameJa: "週刊少年ジャンプ",
  nameRomaji: "Weekly Shonen Jump",
  publisher: "集英社",
  zasshiCode: "29933",
  titleKind: "main",
  firstIssuedOn: "1968-07-11",
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const WRITE = flag("write");
const YEAR = value("year");
const LIMIT = value("limit") ? Number(value("limit")) : null;
const DEBUTS_ONLY = flag("debuts");

for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

async function sq(query) {
  const r = await fetch(`${ENDPOINT}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: "application/sparql-results+json" },
  });
  if (!r.ok) throw new Error(`SPARQL ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).results.bindings;
}

async function rest(method, path, body) {
  const r = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no body */ }
  return { ok: r.ok, status: r.status, json, text };
}

// ---------------------------------------------------------------- fetch ----
const subject = `https://mediaarts-db.artmuseums.go.jp/id/${MAGAZINE.madbId}`;
console.log(`Reading ${MAGAZINE.nameJa} (${MAGAZINE.madbId}) from the Media Arts Database...`);

// schema:name carries both a kanji and a katakana reading and would double
// every row, so it is not selected. The note field is where binding and the
// zasshi code live, as free text.
const bindings = await sq(`SELECT ?s ?tot ?y ?no ?d ?note ?pages ?price WHERE {
  ?s <https://schema.org/isPartOf> <${subject}> ;
     <${P}totalVolumeNumber> ?tot ;
     <${P}yearDisplayed> ?y ;
     <${P}issueNumberDisplayed> ?no ;
     <https://schema.org/datePublished> ?d ;
     <${P}note> ?note .
  OPTIONAL { ?s <https://schema.org/numberOfPages> ?pages }
  OPTIONAL { ?s <https://schema.org/price> ?price }
} ORDER BY ?d`);

// Numeric fields are not consistently numeric: price appears as "210円" as
// often as "210", and pages as "476p" as often as "476". Some older records
// use full-width digits. Pull the first run of digits out rather than
// trusting Number(), which silently yields NaN and would have written NaN
// straight into the review payload.
function digits(binding) {
  if (!binding) return null;
  const normalised = String(binding.value).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const match = normalised.match(/\d+/);
  return match ? Number(match[0]) : null;
}

const all = bindings.map((b) => ({
  madbId: b.s.value.split("/").pop(),
  cumulative: digits(b.tot),
  year: digits(b.y),
  issueLabel: String(b.no.value).replace(/^0+(?=\d)/, ""),
  publishedOn: b.d.value,
  note: b.note.value,
  pages: digits(b.pages),
  price: digits(b.price),
}));
console.log(`  ${all.length} issue records, ${all[0].publishedOn} .. ${all[all.length - 1].publishedOn}`);

// ------------------------------------------------------------- validate ----
const withheld = [];
const withhold = (issue, reason) => withheld.push({ ...issue, reason });

// A weekly's 通巻 should advance roughly in step with date order. A large
// residual means the field holds something other than the running count.
const base = all[0].cumulative;
const drifts = all.map((issue, i) => ({ issue, drift: issue.cumulative - (base + i) }));
const DRIFT_LIMIT = 120;
const badCumulative = new Set(
  drifts.filter((d) => Math.abs(d.drift) > DRIFT_LIMIT).map((d) => d.issue.madbId),
);

// Two distinct collisions, kept apart because they mean different things and
// a reviewer needs to know which they are looking at.
//
// Same year + printed issue number: one physical magazine recorded twice.
// Both known cases are that -- a flip-book whose back cover MADB catalogued
// separately, and a bound-in supplement given its own issue record.
//
// Same 通巻 on different issues: one of the two values is simply wrong, and
// the drift check usually cannot say which.
const sameIssueLabel = new Set();
const sameCumulative = new Set();
const seenLabel = new Map();
const seenCumulative = new Map();
for (const issue of all) {
  const labelKey = `${issue.year}/${issue.issueLabel}`;
  if (seenLabel.has(labelKey)) {
    sameIssueLabel.add(issue.madbId);
    sameIssueLabel.add(seenLabel.get(labelKey));
  } else {
    seenLabel.set(labelKey, issue.madbId);
  }
  if (issue.cumulative === null) continue;
  if (seenCumulative.has(issue.cumulative)) {
    sameCumulative.add(issue.madbId);
    sameCumulative.add(seenCumulative.get(issue.cumulative));
  } else {
    seenCumulative.set(issue.cumulative, issue.madbId);
  }
}

let candidates = [];
for (const issue of all) {
  if (issue.cumulative === null || issue.year === null) {
    withhold(issue, "year or 通巻 is missing or unparseable");
  } else if (sameIssueLabel.has(issue.madbId)) {
    withhold(issue, `${issue.year}年${issue.issueLabel}号 is recorded twice -- one is a supplement or a second cover, not a separate issue`);
  } else if (badCumulative.has(issue.madbId)) {
    withhold(issue, `通巻${issue.cumulative} is implausible for ${issue.publishedOn} -- looks like a transcription error`);
  } else if (sameCumulative.has(issue.madbId)) {
    withhold(issue, `通巻${issue.cumulative} is claimed by another issue too -- one of the two is wrong`);
  } else {
    candidates.push(issue);
  }
}

console.log(`  ${candidates.length} pass validation, ${withheld.length} withheld for a human`);
for (const w of withheld) {
  console.log(`    withheld  ${w.madbId} ${w.year}年${w.issueLabel}号 通巻${w.cumulative} — ${w.reason}`);
}

// ---------------------------------------------------------------- debuts ----
// MADB flags almost no debuts directly (7 parts in the whole run carry a
// 新連載 note), so a debut is derived: a work's earliest appearance in this
// magazine's contents is its first chapter. Checked against four known
// debuts and correct on all four.
//
// The derivation is left-censored, and naively it lies. Coverage starts
// 1969-11-03, so every series already running that week -- 男一匹ガキ大将
// began in 1968 -- has its "first appearance" recorded in the first issue of
// the data. Claiming those as debuts would be inventing an edition claim, so
// anything landing inside the opening window is dropped rather than reported.
const COVERAGE_START = all[0].publishedOn;
const CENSOR_UNTIL = new Date(new Date(COVERAGE_START).getTime() + 400 * 24 * 3600 * 1000)
  .toISOString().slice(0, 10);

const debutByIssue = new Map();
let censoredCount = 0;
if (DEBUTS_ONLY || WRITE) {
  console.log("\nDeriving first appearances from the contents data...");
  const debutRows = await sq(`SELECT ?pn (MIN(?d) AS ?first) WHERE {
    ?s <https://schema.org/isPartOf> <${subject}> ;
       <https://schema.org/datePublished> ?d ;
       <https://schema.org/hasPart> ?p .
    ?p <https://schema.org/name> ?pn ; <https://schema.org/genre> "マンガ作品" .
  } GROUP BY ?pn`);
  const byDate = new Map();
  for (const issue of all) byDate.set(issue.publishedOn, issue);
  for (const row of debutRows) {
    const issue = byDate.get(row.first.value);
    if (!issue) continue;
    if (issue.publishedOn < CENSOR_UNTIL) { censoredCount += 1; continue; }
    if (!debutByIssue.has(issue.madbId)) debutByIssue.set(issue.madbId, []);
    debutByIssue.get(issue.madbId).push(row.pn.value);
  }
  console.log(`  ${debutByIssue.size} issues carry a derivable first appearance`);
  console.log(`  ${censoredCount} dropped: first seen before ${CENSOR_UNTIL}, so the data cannot tell a debut from a series already running`);
  for (const known of ["ONE PIECE", "NARUTO-ナルト-", "BLEACH", "HUNTER×HUNTER"]) {
    const hit = [...debutByIssue.entries()].find(([, works]) => works.includes(known));
    const issue = hit ? all.find((i) => i.madbId === hit[0]) : null;
    console.log(`    ${known.padEnd(16)} ${issue ? `${issue.year}年${issue.issueLabel}号 (${issue.publishedOn})` : "not found"}`);
  }
}

// Debuts of series RAR already catalogues -- the slice worth a human's time.
// Everything else is a debut of something nobody here collects yet.
function fold(value) {
  return String(value ?? "").toLowerCase()
    .replace(/[×✕✖⨯╳]/g, "x")
    .replace(/[^a-z0-9぀-ヿ一-鿿]/g, "");
}
let catalogued = [];
if (DEBUTS_ONLY) {
  const res = await rest("GET", "manga_editions?select=series");
  catalogued = [...new Set((res.json ?? []).map((r) => r.series).filter(Boolean))];
}
function matchesCatalogue(work) {
  const w = fold(work);
  if (w.length < 3) return null;
  return catalogued.find((series) => {
    const s = fold(series);
    return s.length >= 3 && (w === s || w.includes(s) || s.includes(w));
  }) ?? null;
}

// ----------------------------------------------------------------- filter ---
if (YEAR) candidates = candidates.filter((c) => String(c.year) === String(YEAR));
if (DEBUTS_ONLY) {
  const hits = [];
  candidates = candidates.filter((c) => {
    const works = debutByIssue.get(c.madbId) ?? [];
    const matched = works.map((w) => [w, matchesCatalogue(w)]).filter(([, s]) => s);
    if (!matched.length) return false;
    hits.push([c, matched]);
    return true;
  });
  console.log(`\nDebuts of series already in the RAR catalogue:`);
  for (const [issue, matched] of hits) {
    for (const [work, series] of matched) {
      console.log(`  ${issue.year}年${issue.issueLabel}号 (${issue.publishedOn})  ${work}  ->  ${series}`);
    }
  }
}
if (LIMIT) candidates = candidates.slice(0, LIMIT);

console.log(`\n${candidates.length} candidate${candidates.length === 1 ? "" : "s"} selected${YEAR ? ` for ${YEAR}` : ""}${DEBUTS_ONLY ? " carrying a first appearance" : ""}.`);

if (!WRITE) {
  console.log("\nDry run -- nothing written. Sample:");
  for (const c of candidates.slice(0, 8)) {
    const debuts = debutByIssue.get(c.madbId);
    console.log(`  ${c.year}年${c.issueLabel}号  通巻${c.cumulative}  ${c.publishedOn}  ¥${c.price ?? "?"}  ${c.pages ?? "?"}pp${debuts ? `  debut: ${debuts.slice(0, 3).join(", ")}` : ""}`);
  }
  console.log("\nRe-run with --write to queue these for review.");
  process.exit(0);
}

// ------------------------------------------------------------------ write ---
const sourceRes = await rest("GET", `sources?select=id&name=eq.${encodeURIComponent(SOURCE_NAME)}`);
const sourceId = sourceRes.json?.[0]?.id;
if (!sourceId) throw new Error(`Source "${SOURCE_NAME}" is not registered. Apply 20260816_zasshi_identity_model.sql first.`);

let titleRes = await rest("GET", `magazine_titles?select=id&madb_id=eq.${MAGAZINE.madbId}`);
let magazineTitleId = titleRes.json?.[0]?.id;
if (!magazineTitleId) {
  const created = await rest("POST", "magazine_titles", {
    name_ja: MAGAZINE.nameJa,
    name_romaji: MAGAZINE.nameRomaji,
    publisher: MAGAZINE.publisher,
    zasshi_code: MAGAZINE.zasshiCode,
    madb_id: MAGAZINE.madbId,
    title_kind: MAGAZINE.titleKind,
    first_issued_on: MAGAZINE.firstIssuedOn,
  });
  if (!created.ok) throw new Error(`Could not create magazine title: ${created.text.slice(0, 300)}`);
  magazineTitleId = created.json[0].id;
  console.log(`Created magazine title ${MAGAZINE.nameJa} (${magazineTitleId})`);
} else {
  console.log(`Using existing magazine title ${MAGAZINE.nameJa} (${magazineTitleId})`);
}

const existing = await rest("GET", `catalogue_import_queue?select=external_id&source_id=eq.${sourceId}&limit=10000`);
const alreadyQueued = new Set((existing.json ?? []).map((r) => r.external_id));

// The magazine's serial record at NDL. Used when no issue-level record
// exists, which is the common case -- it is at least a real bibliographic
// record for the right magazine rather than a keyword search.
const NDL_SERIAL_URL = "https://ndlsearch.ndl.go.jp/books/R100000002-I028362920";

async function resolveNdl(issue) {
  try {
    const url = `https://ndlsearch.ndl.go.jp/api/opensearch?title=${encodeURIComponent(MAGAZINE.nameJa)}&from=${issue.publishedOn}&until=${issue.publishedOn}&cnt=20`;
    const xml = await (await fetch(url)).text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
    const issueItem = items.find((it) => /<link>[^<]*-i\d+<\/link>/.test(it));
    if (issueItem) {
      const link = issueItem.match(/<link>([^<]*)<\/link>/)[1];
      const volume = (issueItem.match(/<dcndl:volume[^>]*>([^<]*)<\/dcndl:volume>/) || [])[1] ?? "";
      const tsuukan = (volume.match(/通号\s*(\d+)/) || [])[1];
      return {
        url: link,
        label: "NDL record for this issue",
        agrees: tsuukan ? Number(tsuukan) === issue.cumulative : null,
      };
    }
  } catch { /* fall through to the serial record */ }
  return { url: NDL_SERIAL_URL, label: "NDL record for the magazine", agrees: null };
}

let queued = 0;
let skipped = 0;
let failed = 0;
for (const issue of candidates) {
  if (alreadyQueued.has(issue.madbId)) { skipped += 1; continue; }
  const ndl = await resolveNdl(issue);
  if (ndl.agrees === false) {
    console.log(`  NOTE ${issue.year}年${issue.issueLabel}号: NDL disagrees with MADB on 通巻${issue.cumulative} — flagged in the payload for the reviewer`);
  }
  const debuts = debutByIssue.get(issue.madbId) ?? [];
  const zasshiCodeMatch = issue.note.match(/雑誌コード\s*(\d{5})/);
  const row = {
    source_id: sourceId,
    external_id: issue.madbId,
    // NOT https://mediaarts-db.artmuseums.go.jp/id/<id>. That is the record's
    // linked-data identifier and it is what the database's own listing pages
    // link to, but the public site only renders it for books: for a magazine
    // issue or a magazine title it returns an empty shell with nothing on it
    // but an RDF download button. A reviewer following it sees nothing, which
    // makes it useless as a source link.
    //
    // This URL resolves, permanently, to exactly the record RAR imported.
    // It is JSON rather than a page, so a human-readable corroboration link
    // goes in the payload below alongside it.
    source_record_url: `https://mediaarts-db.artmuseums.go.jp/sparql?query=${encodeURIComponent(`DESCRIBE <https://mediaarts-db.artmuseums.go.jp/id/${issue.madbId}>`)}`,
    candidate_kind: "edition_candidate",
    candidate_title: MAGAZINE.nameJa,
    // Romaji deliberately, not the Japanese name again: the matcher checks
    // the title one way and the series the other, so carrying both names
    // lets a listing in either language reach the same record. A Japanese
    // seller writes 週刊少年ジャンプ, an English one writes Weekly Shonen Jump,
    // and neither string contains the other.
    candidate_series: MAGAZINE.nameRomaji,
    candidate_volume_number: `${issue.year}年${issue.issueLabel}号`,
    candidate_publisher: MAGAZINE.publisher,
    candidate_language: "Japanese",
    candidate_release_date: issue.publishedOn,
    // The reviewer passes these through to apply_catalogue_review as
    // p_metadata. Nothing here is applied without that decision.
    raw_payload: {
      review_metadata: {
        collectible_type: "zasshi",
        magazine_title_id: magazineTitleId,
        issue_year: String(issue.year),
        issue_number_label: issue.issueLabel,
        cumulative_issue_no: String(issue.cumulative),
        madb_id: issue.madbId,
      },
      // Resolved per issue against the National Diet Library, not guessed.
      // Their OpenSearch API exposes an issue-level record for some dates and
      // only the magazine-level serial record for the rest -- 1 of the first
      // 13 issues resolved exactly -- so this link says which one it is
      // rather than sending a reviewer into a keyword search. Where an exact
      // record exists, NDL's 通号 is cross-checked against MADB's 通巻: the
      // One Piece debut agrees on 1458 from both sources independently.
      human_readable_url: ndl.url,
      human_readable_url_label: ndl.label,
      ndl_cumulative_agrees: ndl.agrees,
      madb: {
        id: issue.madbId,
        record_uri: `https://mediaarts-db.artmuseums.go.jp/id/${issue.madbId}`,
        published_on: issue.publishedOn,
        cover_price_yen: issue.price,
        pages: issue.pages,
        note: issue.note,
        zasshi_code: zasshiCodeMatch ? zasshiCodeMatch[1] : null,
      },
      // Catalogue facts explaining why an issue is significant. Never price
      // evidence, and never a substitute for a verified sale.
      derived_first_appearances: debuts,
      attribution: "独立行政法人国立美術館国立アートリサーチセンター「メディア芸術データベース」 (https://mediaarts-db.artmuseums.go.jp/)",
    },
  };
  const res = await rest("POST", "catalogue_import_queue", row);
  if (res.ok) queued += 1;
  else { failed += 1; console.log(`  FAILED ${issue.madbId}: ${res.text.slice(0, 160)}`); }
}

console.log(`\nQueued ${queued}, already present ${skipped}, failed ${failed}.`);
console.log("Nothing has been catalogued. Review them at /catalogue-review.");
