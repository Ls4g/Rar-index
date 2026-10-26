// Curated MADB Volume 1 records from the staff-supplied metadata101.json.
// Dry-run by default. --apply stages exact-source matches for human review;
// this never creates an edition or changes a prior review decision.
import { createClient } from "@supabase/supabase-js";
import { searchOpenBdCatalogue, searchShueishaCatalogue } from "../lib/catalogueSources.ts";

const APPLY = process.argv.includes("--apply");
const ENTRIES = [
  ["20th Century Boys", "M267761", "4091855318", "20世紀少年", "小学館"],
  ["3x3 Eyes", "M239579", "4061021230", "3×3EYES", "講談社"],
  ["Ace of Diamond", "M295522", "406363728X", "ダイヤのA", "講談社"],
  ["Bad Boys", "M336568", "4785912030", "BAD BOYS", "少年画報社"],
  ["Be-Bop High School", "M243677", "4061020110", "Be-bop-highschool", "講談社"],
  ["Blue Lock", "M522106", "9784065134009", "ブルーロック", "講談社"],
  ["Dear Boys", "M344210", "4063022889", "Dear boys", "講談社"],
  ["Fairy Tail", "M191486", "4063637719", "FAIRY TAIL", "講談社"],
  ["Great Teacher Onizuka", "M364237", "4063124118", "GTO", "講談社"],
  ["H2", "M315118", "4091231519", "H2", "小学館"],
  ["Hajime no Ippo", "M521730", "9784063115321", "はじめの一歩", "講談社"],
  ["Major", "M272380", "4091234917", "MAJOR", "小学館"],
  ["Nana", "M354059", "4088562097", "NANA", "集英社"],
  ["That Time I Got Reincarnated as a Slime", "M454257", "9784063765786", "転生したらスライムだった件", "講談社"],
  ["The Seven Deadly Sins", "M397151", "9784063848021", "七つの大罪", "講談社"],
  ["Worst", "M243580", "4253202179", "WORST", "秋田書店"],
  ["YuYu Hakusho", "M1079294", "4088712730", "幽☆遊☆白書", "集英社"],
  ["Baki the Grappler", "M328516", "4253053092", "グラップラー刃牙", "秋田書店"],
  ["Chibi Maruko-chan", "M307503", "4088534131", "ちびまる子ちゃん", "集英社"],
  ["Cooking Papa", "M296502", "9784063000047", "クッキングパパ", "講談社"],
  ["Crest of the Royal Family", "M294174", "4253070604", "王家の紋章", "秋田書店"],
  ["Doraemon", "M236091", "4091400019", "ドラえもん", "小学館"],
  ["Dragon Quest: The Adventure of Dai", "M969634", "4088710711", "ドラゴンクエスト", "集英社"],
  ["Inuyasha", "M288996", "409125201X", "犬夜叉", "小学館"],
  ["Itazura na Kiss", "M256208", "4088497279", "イタズラなkiss", "集英社"],
  ["Kimi ni Todoke", "M217987", "4088460618", "君に届け", "集英社"],
  ["Kosaku Shima", "M308948", "4061025430", "課長島耕作", "講談社"],
  ["Kyo Kara Ore Wa!!", "M257957", "4091224016", "今日から俺は!!", "小学館"],
  ["Minami no Teio", "M279940", "453703744X", "ミナミの帝王", "日本文芸社"],
  ["Ranma 1/2", "M268193", "4091220312", "らんま1/2", "小学館"],
  ["Salary Man Kintaro", "M347902", "4088752740", "サラリーマン金太郎", "集英社"],
  ["Shonan Junai Gumi", "M365950", "4063132129", "湘南純愛組!", "講談社"],
  ["Shoot!", "M267110", "4063116328", "シュート!", "講談社"],
  ["Shura no Mon", "M374671", "4063022218", "修羅の門", "講談社"],
  ["Space Brothers", "M290363", "9784063726749", "宇宙兄弟", "講談社"],
  ["Super Radical Gag Family", "M339144", "425305434X", "浦安鉄筋家族", "秋田書店"],
  ["The Kindaichi Case Files", "M200547", "4063118746", "金田一少年の事件簿", "講談社"],
  ["The Silent Service", "M313349", "4061026925", "沈黙の艦隊", "講談社"],
  ["Yowamushi Pedal", "M206389", "9784253214513", "弱虫ペダル", "秋田書店"],
  ["Yu-Gi-Oh!", "M304849", "4088723112", "遊・戯・王", "集英社"],
  ["Frieren: Beyond Journey's End", "M822780", "9784098501809", "葬送のフリーレン", "小学館"],
  ["The Apothecary Diaries", "M493185", "9784757554894", "薬屋のひとりごと", "スクウェア・エニックス"],
];

function isbn13(value) {
  if (/^97[89]\d{10}$/.test(value)) return value;
  if (!/^\d{9}[\dX]$/.test(value)) throw new Error(`Invalid ISBN: ${value}`);
  const base = `978${value.slice(0, 9)}`;
  const sum = [...base].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}
function key(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[×✕]/g, "x").replace(/[^\p{L}\p{N}]+/gu, "");
}
function titleMatches(candidateTitle, expected) {
  const text = String(candidateTitle ?? "").normalize("NFKC")
    .replace(/\s+1\s*\([^)]*\)\s*$/u, " 1");
  const beforeSubtitle = text.split(/\s+[=:]\s+/u)[0];
  const withoutVolume = beforeSubtitle.replace(/(?:[.．\s（(]+(?:第)?1(?:巻)?[）)]?)$/u, "").trim();
  // MADB states volume 1 for this exact ISBN; some OpenBD records omit the
  // number from their title, so an otherwise exact title is still reviewable.
  return key(withoutVolume) === key(expected);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const isbns = ENTRIES.map((entry) => isbn13(entry[2]));
const [sourceResult, editionResult, queueResult, targetResult] = await Promise.all([
  admin.from("sources").select("id,name").in("name", ["OpenBD", "Shueisha Direct"]),
  admin.from("manga_editions").select("id,isbn_13").in("isbn_13", isbns),
  admin.from("catalogue_import_queue").select("id,candidate_isbn_13,status").in("candidate_isbn_13", isbns),
  admin.from("catalogue_discovery_targets").select("id,title_english,status").eq("discovery_source", "staff_fast_track").eq("language", "Japanese").eq("next_missing_volume", 1).limit(200),
]);
for (const result of [sourceResult, editionResult, queueResult, targetResult]) if (result.error) throw result.error;
const sources = new Map(sourceResult.data.map((row) => [row.name, row.id]));
const published = new Set(editionResult.data.map((row) => row.isbn_13));
const queued = new Map(queueResult.data.map((row) => [row.candidate_isbn_13, row.status]));
const targets = new Map(targetResult.data.map((row) => [row.title_english, row]));
const outcomes = [];

for (const [series, madbId, originalIsbn, title, publisher] of ENTRIES) {
  const isbn = isbn13(originalIsbn);
  const target = targets.get(series);
  if (!target) throw new Error(`Missing target: ${series}`);
  if (published.has(isbn)) { outcomes.push({ series, status: "already_published", isbn }); continue; }
  if (queued.has(isbn)) { outcomes.push({ series, status: `already_queued:${queued.get(isbn)}`, isbn }); continue; }
  // The official Shueisha ISBN page is preferable when it responds. OpenBD
  // remains an exact-ISBN bibliographic source for older titles and others.
  let candidate = null;
  let sourceName = "OpenBD";
  let sourceError = null;
  if (publisher === "集英社") {
    try { candidate = (await searchShueishaCatalogue(isbn))[0] ?? null; sourceName = "Shueisha Direct"; }
    catch (error) { sourceError = String(error); }
  }
  if (!candidate) {
    try { candidate = (await searchOpenBdCatalogue(isbn))[0] ?? null; sourceName = "OpenBD"; }
    catch (error) { sourceError = String(error); }
  }
  if (!candidate) { outcomes.push({ series, status: "source_unavailable", isbn, sourceError }); continue; }
  if (candidate.candidate_isbn_13 !== isbn || !titleMatches(candidate.candidate_title, title)
    || !key(candidate.candidate_publisher).includes(key(publisher))
    || (candidate.candidate_language && candidate.candidate_language !== "Japanese")) {
    outcomes.push({ series, status: "source_mismatch", isbn, source: sourceName,
      sourceTitle: candidate.candidate_title, sourcePublisher: candidate.candidate_publisher });
    continue;
  }
  const row = {
    source_id: sources.get(sourceName),
    external_id: candidate.external_id,
    source_record_url: candidate.source_record_url,
    raw_payload: {
      ...candidate.raw_payload,
      staff_fast_track: {
        target_id: target.id,
        requested_series: series,
        volume: 1,
        madb_id: madbId,
        madb_isbn_13: isbn,
        madb_record_url: `https://mediaarts-db.artmuseums.go.jp/sparql?query=${encodeURIComponent(`DESCRIBE <https://mediaarts-db.artmuseums.go.jp/id/${madbId}>`)}`,
        language_source: candidate.candidate_language ? sourceName : "Manga DataBase metadata101.json",
        note: "Staff-curated original-format candidate from MADB. Confirm exact edition and printing before approval.",
      },
    },
    candidate_kind: "edition_candidate",
    candidate_title: candidate.candidate_title,
    candidate_series: series,
    candidate_volume_number: "1",
    candidate_author: candidate.candidate_author,
    candidate_publisher: candidate.candidate_publisher,
    candidate_language: candidate.candidate_language ?? "Japanese",
    candidate_isbn_13: isbn,
    candidate_release_date: candidate.candidate_release_date,
    candidate_format: candidate.candidate_format ?? null,
    candidate_cover_image_url: candidate.candidate_cover_image_url ?? null,
  };
  if (!sources.get(sourceName)) throw new Error(`Missing source ${sourceName}`);
  if (APPLY) {
    const { data, error } = await admin.from("catalogue_import_queue")
      .upsert(row, { onConflict: "source_id,external_id", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    if (data.length) {
      const { error: targetError } = await admin.from("catalogue_discovery_targets")
        .update({ status: "staged", last_result: "staged", last_checked_at: new Date().toISOString(), failure_count: 0 })
        .eq("id", target.id).eq("status", "researchable");
      if (targetError) throw targetError;
    }
    outcomes.push({ series, status: data.length ? "staged_for_review" : "already_queued", isbn, source: sourceName });
  } else {
    outcomes.push({ series, status: "ready_to_stage", isbn, source: sourceName,
      title: candidate.candidate_title, publisher: candidate.candidate_publisher });
  }
}
console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry_run", outcomes }, null, 2));
