// A small, evidence-checked tranche of the staff's 91 missing Japanese Vol. 1s.
// Run without --apply to inspect the live source responses and duplicate checks.
// --apply queues candidates for human catalogue review; it never publishes them.
// MADB identifiers and Japanese-language claims were checked against the
// staff-supplied metadata101.json. The ISBN is rechecked at the live source.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { searchOpenBdCatalogue, searchShueishaCatalogue } from "../lib/catalogueSources.ts";

const APPLY = process.argv.includes("--apply");
const CANDIDATES = [
  { series: "Case Closed", isbn: "9784091233714", title: "名探偵コナン", publisher: "小学館", madbId: "M314081", source: "OpenBD" },
  { series: "Dragon Ball", isbn: "9784088518312", title: "DRAGON BALL", publisher: "Shueisha", madbId: "M307334", source: "Shueisha Direct" },
  { series: "Oishinbo", isbn: "9784091807519", title: "美味しんぼ", publisher: "小学館", madbId: "M299351", source: "OpenBD" },
  { series: "Kingdom", isbn: "9784088770796", title: "キングダム", publisher: "Shueisha", madbId: "M323743", source: "Shueisha Direct" },
  { series: "Captain Tsubasa", isbn: "9784088512815", title: "キャプテン翼", publisher: "Shueisha", madbId: "M1079286", source: "Shueisha Direct" },
  { series: "Fullmetal Alchemist", isbn: "9784757506206", title: "鋼の錬金術師", publisher: "エニックス", madbId: "M300404", source: "OpenBD" },
  { series: "Vagabond", isbn: "9784063286199", title: "バガボンド", publisher: "講談社", madbId: "M292363", source: "OpenBD" },
  { series: "Tokyo Revengers", isbn: "9784063959383", title: "東京卍リベンジャーズ", publisher: "講談社", madbId: "M482416", source: "OpenBD" },
  { series: "Haikyu!!", isbn: "9784088704531", title: "ハイキュー", publisher: "Shueisha", madbId: "M387106", source: "Shueisha Direct" },
  { series: "Berserk", isbn: "9784592135746", title: "ベルセルク", publisher: "白泉社", madbId: "M314242", source: "OpenBD" },
];

function loadEnv() {
  for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match) process.env[match[1]] ??= match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

function validIsbn13(isbn) {
  if (!/^97[89]\d{10}$/.test(isbn)) return false;
  return [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0;
}

function normalized(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

loadEnv();
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase credentials.");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const isbns = CANDIDATES.map((entry) => entry.isbn);
const [sourceResult, editionResult, queueResult, targetResult] = await Promise.all([
  admin.from("sources").select("id,name").in("name", ["OpenBD", "Shueisha Direct"]),
  admin.from("manga_editions").select("id,isbn_13").in("isbn_13", isbns),
  admin.from("catalogue_import_queue").select("id,candidate_isbn_13,status").in("candidate_isbn_13", isbns),
  admin.from("catalogue_discovery_targets").select("id,title_english,language,status").eq("discovery_source", "staff_fast_track").eq("language", "Japanese").eq("next_missing_volume", 1).limit(200),
]);
for (const result of [sourceResult, editionResult, queueResult, targetResult]) if (result.error) throw result.error;
const sources = new Map(sourceResult.data.map((row) => [row.name, row.id]));
const published = new Set(editionResult.data.map((row) => row.isbn_13));
const queued = new Map(queueResult.data.map((row) => [row.candidate_isbn_13, row]));
const targets = new Map(targetResult.data.map((row) => [row.title_english, row]));
const outcomes = [];

for (const entry of CANDIDATES) {
  if (!validIsbn13(entry.isbn)) throw new Error(`Invalid ISBN: ${entry.isbn}`);
  const sourceId = sources.get(entry.source);
  const target = targets.get(entry.series);
  if (!sourceId || !target) throw new Error(`Missing source or fast-track target: ${entry.series}`);
  if (published.has(entry.isbn)) { outcomes.push({ series: entry.series, status: "already_published" }); continue; }
  if (queued.has(entry.isbn)) { outcomes.push({ series: entry.series, status: `already_queued:${queued.get(entry.isbn).status}` }); continue; }
  const matches = await (entry.source === "Shueisha Direct" ? searchShueishaCatalogue(entry.isbn) : searchOpenBdCatalogue(entry.isbn));
  const candidate = matches.find((row) => row.candidate_isbn_13 === entry.isbn);
  if (!candidate || !normalized(candidate.candidate_title).includes(normalized(entry.title))
    || !normalized(candidate.candidate_publisher).includes(normalized(entry.publisher))
    || !/(?:^|[^0-9])1(?:[^0-9]|$)/u.test(candidate.candidate_title)
    || (candidate.candidate_language && candidate.candidate_language !== "Japanese")) {
    outcomes.push({ series: entry.series, status: "source_mismatch", sourceTitle: candidate?.candidate_title ?? null });
    continue;
  }
  const row = {
    source_id: sourceId,
    external_id: candidate.external_id,
    source_record_url: candidate.source_record_url,
    raw_payload: {
      ...candidate.raw_payload,
      staff_fast_track: {
        target_id: target.id,
        requested_series: entry.series,
        volume: 1,
        madb_record_url: `https://mediaarts-db.artmuseums.go.jp/id/${entry.madbId}`,
        madb_language: "日本語",
        madb_isbn_13: entry.isbn,
        language_source: candidate.candidate_language ? entry.source : "Manga DataBase metadata101.json",
        note: "Candidate only. Staff must verify exact edition, publisher, binding, and printing before approval.",
      },
    },
    candidate_kind: "edition_candidate",
    candidate_title: candidate.candidate_title,
    candidate_series: entry.series,
    candidate_volume_number: "1",
    candidate_author: candidate.candidate_author,
    candidate_publisher: candidate.candidate_publisher,
    candidate_language: candidate.candidate_language ?? "Japanese",
    candidate_isbn_13: entry.isbn,
    candidate_release_date: candidate.candidate_release_date,
    candidate_format: candidate.candidate_format ?? null,
    candidate_cover_image_url: candidate.candidate_cover_image_url ?? null,
  };
  if (APPLY) {
    const { data, error } = await admin.from("catalogue_import_queue").upsert(row, { onConflict: "source_id,external_id", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    if (data.length) {
      const { error: targetError } = await admin.from("catalogue_discovery_targets").update({ status: "staged", last_result: "staged", last_checked_at: new Date().toISOString(), failure_count: 0 }).eq("id", target.id);
      if (targetError) throw targetError;
    }
    outcomes.push({ series: entry.series, status: data.length ? "staged_for_human_review" : "already_queued" });
  } else {
    outcomes.push({ series: entry.series, status: "ready_to_stage", title: candidate.candidate_title, isbn: entry.isbn, publisher: candidate.candidate_publisher, languageSource: candidate.candidate_language ? entry.source : "MADB" });
  }
}
console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry_run", outcomes, safety: "No edition is published or verified by this script." }, null, 2));
