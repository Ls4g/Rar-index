// Staff-requested fast-track batch for recognisable manga Volume 1 records.
//
// Dry run (default):
//   node --experimental-strip-types scripts/fast-track-top-manga-vol1.mjs
// Apply missing targets to the existing discovery backlog:
//   node --experimental-strip-types scripts/fast-track-top-manga-vol1.mjs --apply
//
// This never creates a manga edition. It only moves missing English/Japanese
// Volume 1 research targets ahead of ordinary catalogue discovery. English
// targets can use the existing Open Library staging path. Japanese targets are
// deliberately held until an exact official publisher/ISBN source is supplied.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { normaliseSeriesKey, planRun } from "../lib/catalogueBacklog.ts";

const BATCH_KEY = "top-selling-vol-1-2026-09";
const APPLY = process.argv.includes("--apply");

const SERIES = [
  { name: "One Piece", aliases: ["ONE PIECE"] },
  { name: "Doraemon" },
  { name: "Golgo 13" },
  { name: "Case Closed", aliases: ["Detective Conan", "Meitantei Conan"] },
  { name: "Dragon Ball" },
  { name: "Naruto" },
  { name: "Demon Slayer: Kimetsu no Yaiba", aliases: ["Demon Slayer", "Kimetsu no Yaiba"] },
  { name: "Slam Dunk" },
  { name: "KochiKame: Tokyo Beat Cops", aliases: ["KochiKame", "Kochira Katsushika-ku Kameari Koen-mae Hashutsujo"] },
  { name: "Jujutsu Kaisen" },
  { name: "Crayon Shin-chan", aliases: ["Crayon Shinchan"] },
  { name: "Attack on Titan", aliases: ["Shingeki no Kyojin"] },
  { name: "Oishinbo" },
  { name: "Bleach" },
  { name: "JoJo's Bizarre Adventure", aliases: ["JoJo’s Bizarre Adventure", "Jojo no Kimyo na Boken"] },
  { name: "Kingdom" },
  { name: "Astro Boy", aliases: ["Tetsuwan Atom"] },
  { name: "Baki the Grappler", aliases: ["Grappler Baki"] },
  { name: "Fist of the North Star", aliases: ["Hokuto no Ken"] },
  { name: "Hajime no Ippo", aliases: ["Fighting Spirit"] },
  { name: "Hunter x Hunter", aliases: ["Hunter × Hunter", "Hunter Hunter"] },
  { name: "The Kindaichi Case Files", aliases: ["Kindaichi Case Files", "Kindaichi Shonen no Jikenbo"] },
  { name: "My Hero Academia", aliases: ["Boku no Hero Academia"] },
  { name: "Touch" },
  { name: "Captain Tsubasa" },
  { name: "Fullmetal Alchemist", aliases: ["Hagane no Renkinjutsushi"] },
  { name: "Sazae-san", aliases: ["Sazae San"] },
  { name: "Kinnikuman" },
  { name: "Vagabond" },
  { name: "Sangokushi" },
  { name: "Tokyo Revengers" },
  { name: "Haikyu!!", aliases: ["Haikyu", "Haikyuu"] },
  { name: "Gintama" },
  { name: "Fairy Tail" },
  { name: "Rurouni Kenshin" },
  { name: "Berserk" },
  { name: "Major" },
  { name: "That Time I Got Reincarnated as a Slime", aliases: ["Tensei Shitara Slime Datta Ken"] },
  { name: "Boys Over Flowers", aliases: ["Hana Yori Dango"] },
  { name: "Blue Lock" },
  { name: "The Prince of Tennis", aliases: ["Prince of Tennis", "Tennis no Ojisama"] },
  { name: "Rokudenashi Blues" },
  { name: "Initial D" },
  { name: "Bad Boys" },
  { name: "H2" },
  { name: "Ranma 1/2", aliases: ["Ranma ½"] },
  { name: "The Seven Deadly Sins", aliases: ["Seven Deadly Sins", "Nanatsu no Taizai"] },
  { name: "Shura no Mon" },
  { name: "Minami no Teio" },
  { name: "Super Radical Gag Family", aliases: ["Urayasu Tekkin Kazoku"] },
  { name: "City Hunter" },
  { name: "Cobra", aliases: ["Space Adventure Cobra"] },
  { name: "Devilman" },
  { name: "Dragon Quest: The Adventure of Dai", aliases: ["Dragon Quest Dai no Daiboken", "The Adventure of Dai"] },
  { name: "Fisherman Sanpei", aliases: ["Tsurikichi Sanpei"] },
  { name: "Glass Mask", aliases: ["Glass no Kamen"] },
  { name: "Great Teacher Onizuka", aliases: ["GTO"] },
  { name: "Inuyasha", aliases: ["InuYasha"] },
  { name: "Nana" },
  { name: "Saint Seiya", aliases: ["Knights of the Zodiac"] },
  { name: "Shoot!" },
  { name: "YuYu Hakusho", aliases: ["Yu Yu Hakusho", "YuYu Hakusho"] },
  { name: "Dokaben" },
  { name: "Black Jack" },
  { name: "Kosaku Shima", aliases: ["Kacho Shima Kosaku", "Shima Kosaku"] },
  { name: "Tokyo Ghoul" },
  { name: "Crows" },
  { name: "Sailor Moon", aliases: ["Pretty Guardian Sailor Moon"] },
  { name: "Shizukanaru Don", aliases: ["The Quiet Don"] },
  { name: "Ace of Diamond", aliases: ["Diamond no Ace"] },
  { name: "The Apothecary Diaries", aliases: ["Kusuriya no Hitorigoto"] },
  { name: "Dear Boys" },
  { name: "Shonan Junai Gumi", aliases: ["Shonan Junai Gumi!"] },
  { name: "Yu-Gi-Oh!", aliases: ["Yu-Gi-Oh", "Yugioh"] },
  { name: "The Promised Neverland", aliases: ["Promised Neverland", "Yakusoku no Neverland"] },
  { name: "Spy x Family", aliases: ["SPY×FAMILY", "Spy Family"] },
  { name: "Be-Bop High School", aliases: ["Be-Bop Highschool"] },
  { name: "Cooking Papa" },
  { name: "Crest of the Royal Family", aliases: ["Ouke no Monsho"] },
  { name: "Kyo Kara Ore Wa!!", aliases: ["Kyou kara Ore wa!!"] },
  { name: "Nodame Cantabile" },
  { name: "One-Punch Man", aliases: ["One Punch Man"] },
  { name: "Shaman King" },
  { name: "20th Century Boys" },
  { name: "Black Butler", aliases: ["Kuroshitsuji"] },
  { name: "Chainsaw Man" },
  { name: "Kimi ni Todoke", aliases: ["From Me to You"] },
  { name: "The Chef", aliases: ["The Chef: A New Generation"] },
  { name: "Chibi Maruko-chan", aliases: ["Chibi Maruko Chan"] },
  { name: "Frieren: Beyond Journey's End", aliases: ["Frieren: Beyond Journey’s End", "Sousou no Frieren"] },
  { name: "Itazura na Kiss" },
  { name: "Salary Man Kintaro", aliases: ["Salaryman Kintaro"] },
  { name: "Space Brothers", aliases: ["Uchu Kyodai"] },
  { name: "Urusei Yatsura" },
  { name: "Worst" },
  { name: "Yowamushi Pedal" },
  { name: "3x3 Eyes" },
  { name: "Kaze Densetsu: Bukkomi no Taku", aliases: ["Bukkoumi no Taku", "Bukkomi no Taku"] },
  { name: "Hell Teacher: Jigoku Sensei Nube", aliases: ["Jigoku Sensei Nube", "Hell Teacher Nube"] },
  { name: "The Silent Service", aliases: ["Chinmoku no Kantai"] },
];

function loadEnv() {
  for (const line of fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#][^=]*)=(.*)$/);
    if (!match) continue;
    process.env[match[1].trim()] ??= match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}

function isVolumeOne(row) {
  const volume = Number.parseInt(String(row.volume_number ?? ""), 10);
  if (volume === 1) return true;
  return /\bvol(?:ume)?\.?\s*0?1\b/i.test(String(row.title ?? ""));
}

function keysFor(entry) {
  return new Set([entry.name, ...(entry.aliases ?? [])].map(normaliseSeriesKey).filter(Boolean));
}

function editionMatches(entry, edition) {
  const editionKeys = [edition.series, edition.title].map(normaliseSeriesKey).filter(Boolean);
  const wanted = keysFor(entry);
  return editionKeys.some((key) => wanted.has(key) || [...wanted].some((alias) => key.startsWith(`${alias} `)));
}

function targetRow(entry, language, priorityIndex, existing) {
  const seriesKey = normaliseSeriesKey(entry.name);
  const now = new Date().toISOString();
  const status = language === "English" ? "researchable" : "watching";
  return {
    ...(existing ?? {}),
    id: existing?.id ?? crypto.randomUUID(),
    discovery_source: "staff_fast_track",
    external_id: `staff-fast-track:${BATCH_KEY}:${seriesKey}:${language.toLowerCase()}:1`,
    title_english: entry.name,
    title_romaji: existing?.title_romaji ?? null,
    title_native: existing?.title_native ?? null,
    series_key: seriesKey,
    lane: "established",
    language,
    // Preserve SP's order inside the fast-track batch.
    score: 1_000_000 - priorityIndex,
    series_status: existing?.series_status ?? null,
    reported_volume_count: existing?.reported_volume_count ?? null,
    next_missing_volume: 1,
    status,
    source_url: existing?.source_url ?? null,
    source_metadata: {
      ...(existing?.source_metadata ?? {}),
      staff_fast_track: true,
      batch: BATCH_KEY,
      requested_by: "SP",
      requested_title: entry.name,
      aliases: entry.aliases ?? [],
      note: language === "English"
        ? "Staff-prioritised Volume 1 research target. A bibliographic record must still prove the physical edition before catalogue review."
        : "Staff-prioritised Japanese Volume 1 research target. Hold until an exact official publisher record and ISBN prove the physical edition.",
    },
    last_checked_at: null,
    next_check_at: null,
    failure_count: 0,
    last_result: null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
}

loadEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("RAR Supabase credentials are missing from .env.local.");

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [{ data: editions, error: editionError }, { data: existingTargets, error: targetError }] = await Promise.all([
  admin.from("manga_editions").select("id,title,series,volume_number,language,publisher,isbn_13,is_verified,collectible_type").eq("is_verified", true).eq("collectible_type", "tankobon").limit(5000),
  admin.from("catalogue_discovery_targets").select("*").limit(5000),
]);
if (editionError) throw editionError;
if (targetError) throw targetError;

const exactVolumeOne = (editions ?? []).filter(isVolumeOne);
const existingByIdentity = new Map((existingTargets ?? []).map((target) => [
  `${target.series_key}:${target.language ?? ""}:${target.next_missing_volume ?? 0}`,
  target,
]));

const coverage = [];
const rows = [];
for (const [priorityIndex, entry] of SERIES.entries()) {
  for (const language of ["English", "Japanese"]) {
    const edition = exactVolumeOne.find((candidate) => candidate.language === language && editionMatches(entry, candidate));
    const seriesKey = normaliseSeriesKey(entry.name);
    const existing = existingByIdentity.get(`${seriesKey}:${language}:1`) ?? null;
    coverage.push({ series: entry.name, language, state: edition ? "already_published" : existing?.status ? `target_${existing.status}` : "missing" });
    if (!edition && existing?.status !== "staged" && existing?.status !== "published") rows.push(targetRow(entry, language, priorityIndex, existing));
  }
}

if (APPLY && rows.length) {
  const { error } = await admin.from("catalogue_discovery_targets").upsert(rows, {
    onConflict: "series_key,language,next_missing_volume",
  });
  if (error) throw error;
}

const counts = coverage.reduce((result, item) => {
  result[item.state] = (result[item.state] ?? 0) + 1;
  return result;
}, {});
const byLanguage = coverage.reduce((result, item) => {
  result[item.language] ??= {};
  result[item.language][item.state] = (result[item.language][item.state] ?? 0) + 1;
  return result;
}, {});
const existingSeries = [...new Set(coverage.filter((item) => item.state === "already_published").map((item) => item.series))];
const nextRun = planRun((existingTargets ?? []).filter((target) => target.status === "researchable"));
console.log(JSON.stringify({
  mode: APPLY ? "applied" : "dry_run",
  batch: BATCH_KEY,
  requestedSeries: SERIES.length,
  requestedEditionTargets: SERIES.length * 2,
  counts,
  byLanguage,
  targetsWritten: APPLY ? rows.length : 0,
  wouldWrite: rows.length,
  existingSeries,
  nextRun: nextRun.map((target) => ({ title: target.title_english, language: target.language, volume: target.next_missing_volume, source: target.discovery_source })),
  safety: "No manga edition was created or verified by this script.",
}, null, 2));
