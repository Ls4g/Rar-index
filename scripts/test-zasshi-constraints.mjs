// Validates the zasshi identity model against real Weekly Shonen Jump data
// (MADB C119459 / M543439, the One Piece debut).
//
// UNLIKE the other scripts in here, this one is not a pure-logic test: the
// constraints it exercises live in Postgres, so it writes to whichever
// database .env.local points at -- production, in practice. Every row it
// creates is torn down at the end and the last two assertions verify that
// nothing was left behind. Teardown order matters:
// catalogue_import_queue.matched_edition_id and edition_sources.edition_id
// both reference manga_editions, so those go before the editions do.
//
// Run: node scripts/test-zasshi-constraints.mjs
import fs from "node:fs";

for (const line of fs.readFileSync("C:/Users/S-P-J/Documents/RAR/.env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Prefer: "return=representation" };

const created = { editions: [], titles: [], imports: [] };
let pass = 0;
let fail = 0;

async function req(method, path, body) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty body on delete */ }
  return { ok: r.ok, status: r.status, json, text };
}

function check(label, condition, detail = "") {
  if (condition) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`); }
}

async function expectRejected(label, path, body, expectedFragment) {
  const res = await req("POST", path, body);
  if (res.ok) {
    if (res.json?.[0]?.id) created.editions.push(res.json[0].id);
    check(label, false, "insert was ACCEPTED but should have been rejected");
    return;
  }
  const message = res.json?.message ?? res.text;
  check(label, message.includes(expectedFragment), `expected /${expectedFragment}/, got: ${message.slice(0, 160)}`);
}

console.log("\n--- magazine title ---");
const titleRes = await req("POST", "magazine_titles", {
  name_ja: "週刊少年ジャンプ",
  name_romaji: "Weekly Shonen Jump",
  publisher: "集英社",
  zasshi_code: "29933",
  madb_id: "C119459",
  title_kind: "main",
  first_issued_on: "1968-07-11",
});
check("real magazine title inserts", titleRes.ok, titleRes.text.slice(0, 200));
const titleId = titleRes.json?.[0]?.id;
if (titleId) created.titles.push(titleId);

const dupeTitle = await req("POST", "magazine_titles", { name_ja: "週刊少年ジャンプ", publisher: "集英社" });
check("same magazine cannot be added twice", !dupeTitle.ok);
if (dupeTitle.ok) created.titles.push(dupeTitle.json[0].id);

console.log("\n--- issue identity is mandatory ---");
await expectRejected(
  "zasshi without a magazine is rejected",
  "manga_editions",
  { title: "週刊少年ジャンプ", language: "Japanese", collectible_type: "zasshi", issue_year: 1997, issue_number_label: "34" },
  "manga_editions_zasshi_identity_check",
);
await expectRejected(
  "zasshi without a year is rejected",
  "manga_editions",
  { title: "週刊少年ジャンプ", language: "Japanese", collectible_type: "zasshi", magazine_title_id: titleId, issue_number_label: "34" },
  "manga_editions_zasshi_identity_check",
);
await expectRejected(
  "tankobon carrying magazine fields is rejected",
  "manga_editions",
  { title: "One Piece Vol. 1", language: "Japanese", collectible_type: "tankobon", magazine_title_id: titleId, issue_year: 1997, issue_number_label: "34" },
  "manga_editions_zasshi_identity_check",
);

console.log("\n--- the real issue ---");
const debut = await req("POST", "manga_editions", {
  title: "週刊少年ジャンプ",
  series: "週刊少年ジャンプ",
  volume_number: "1997年34号",
  publisher: "集英社",
  language: "Japanese",
  collectible_type: "zasshi",
  magazine_title_id: titleId,
  issue_year: 1997,
  issue_number_label: "34",
  cumulative_issue_no: 1458,
  madb_id: "M543439",
  release_date: "1997-08-04",
  is_verified: false,
});
check("WSJ 1997 no.34 (通巻1458) inserts", debut.ok, debut.text.slice(0, 200));
const debutId = debut.json?.[0]?.id;
if (debutId) created.editions.push(debutId);

console.log("\n--- duplicate protection ---");
await expectRejected(
  "same 通巻 twice is rejected",
  "manga_editions",
  { title: "Weekly Shonen Jump", language: "Japanese", collectible_type: "zasshi", magazine_title_id: titleId, issue_year: 1997, issue_number_label: "34 (dup)", cumulative_issue_no: 1458 },
  "manga_editions_zasshi_cumulative_unique",
);
await expectRejected(
  "same year+issue twice is rejected",
  "manga_editions",
  { title: "Weekly Shonen Jump", language: "Japanese", collectible_type: "zasshi", magazine_title_id: titleId, issue_year: 1997, issue_number_label: "34", cumulative_issue_no: 9999 },
  "manga_editions_zasshi_issue_label_unique",
);

const neighbour = await req("POST", "manga_editions", {
  title: "週刊少年ジャンプ", language: "Japanese", collectible_type: "zasshi",
  magazine_title_id: titleId, issue_year: 1997, issue_number_label: "35", cumulative_issue_no: 1459,
});
check("the next issue (通巻1459) still inserts", neighbour.ok, neighbour.text.slice(0, 200));
if (neighbour.json?.[0]?.id) created.editions.push(neighbour.json[0].id);

const combined = await req("POST", "manga_editions", {
  title: "週刊少年ジャンプ", language: "Japanese", collectible_type: "zasshi",
  magazine_title_id: titleId, issue_year: 1998, issue_number_label: "4・5", cumulative_issue_no: 1478,
});
check("a 合併号 (combined issue) inserts", combined.ok, combined.text.slice(0, 200));
if (combined.json?.[0]?.id) created.editions.push(combined.json[0].id);

console.log("\n--- apply_catalogue_review zasshi branch ---");
const sources = await req("GET", "sources?select=id&name=eq.Media Arts Database");
const sourceId = sources.json?.[0]?.id;
const queued = await req("POST", "catalogue_import_queue", {
  source_id: sourceId,
  external_id: `test-zasshi-${Date.now()}`,
  source_record_url: "https://mediaarts-db.artmuseums.go.jp/id/M543439",
  candidate_kind: "edition_candidate",
  candidate_title: "週刊少年ジャンプ",
  candidate_language: "Japanese",
  raw_payload: {},
});
check("test candidate queued", queued.ok, queued.text.slice(0, 200));
const importId = queued.json?.[0]?.id;
if (importId) created.imports.push(importId);

async function review(metadata) {
  const r = await fetch(`${URL_}/rest/v1/rpc/apply_catalogue_review`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      p_catalogue_import_id: importId,
      p_decision: "approve_new",
      p_decision_notes: "constraint test",
      p_reviewed_by: "migration-test",
      p_metadata: metadata,
    }),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* plain uuid */ }
  return { ok: r.ok, message: json?.message ?? text, id: typeof json === "string" ? json : null };
}

if (importId) {
  let r = await review({ collectible_type: "zasshi", issue_year: "1997", issue_number_label: "34" });
  check("review rejects a magazine with no magazine named", !r.ok && r.message.includes("must name the magazine"), r.message.slice(0, 160));

  r = await review({ collectible_type: "zasshi", magazine_title_id: titleId });
  check("review rejects a magazine with no year/issue", !r.ok && r.message.includes("requires its year"), r.message.slice(0, 160));

  r = await review({ collectible_type: "zasshi", magazine_title_id: titleId, issue_year: "1997", issue_number_label: "34", cumulative_issue_no: "1458" });
  check("review blocks an already-catalogued issue", !r.ok && r.message.includes("already catalogued"), r.message.slice(0, 160));

  r = await review({ collectible_type: "tankobon", magazine_title_id: titleId, issue_year: "1997", issue_number_label: "34" });
  check("review rejects magazine fields on a book", !r.ok && r.message.includes("only valid on a zasshi"), r.message.slice(0, 160));

  r = await review({ collectible_type: "zasshi", magazine_title_id: titleId, issue_year: "1997", issue_number_label: "36", cumulative_issue_no: "1460" });
  check("review approves a genuinely new issue", r.ok && Boolean(r.id), r.message.slice(0, 160));
  if (r.id) created.editions.push(r.id);

  // The ISBN path must be untouched by all of this. Uses an ISBN-shaped value
  // that belongs to nothing, so the duplicate-ISBN guard is not what is being
  // measured here -- that guard has its own coverage above.
  r = await review({ collectible_type: "tankobon", isbn_13: "9789999999990", title: "Constraint test book", language: "Japanese" });
  check("book approval still works (ISBN path unaffected)", r.ok && Boolean(r.id), r.message.slice(0, 160));
  if (r.id) created.editions.push(r.id);

  // And the duplicate-ISBN guard itself still fires, using a real catalogued
  // ISBN (One Piece Vol. 1 Japanese).
  r = await review({ collectible_type: "tankobon", isbn_13: "9784088725093", title: "ONE PIECE 1", language: "Japanese" });
  check("duplicate-ISBN guard still fires", !r.ok && r.message.includes("already exists in the catalogue"), r.message.slice(0, 160));
  if (r.id) created.editions.push(r.id);
}

console.log("\n--- cleanup ---");
// Order matters: catalogue_import_queue.matched_edition_id references
// manga_editions, so the queue rows must go first or the edition deletes are
// silently refused.
for (const id of created.imports) {
  await req("DELETE", `catalogue_review_decisions?catalogue_import_id=eq.${id}`);
  await req("DELETE", `catalogue_import_queue?id=eq.${id}`);
}
for (const id of created.editions) {
  await req("DELETE", `edition_sources?edition_id=eq.${id}`);
  await req("DELETE", `manga_editions?id=eq.${id}`);
}
for (const id of created.titles) await req("DELETE", `magazine_titles?id=eq.${id}`);

const leftEditions = await req("GET", "manga_editions?select=id&collectible_type=eq.zasshi");
const leftTitles = await req("GET", "magazine_titles?select=id");
check("no zasshi rows left behind", (leftEditions.json ?? []).length === 0, JSON.stringify(leftEditions.json));
check("no magazine titles left behind", (leftTitles.json ?? []).length === 0, JSON.stringify(leftTitles.json));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
