// Compare staff's MADB export with the existing Japanese Vol. 1 fast-track.
// This is read-only. No catalogue candidate is staged by this script.
import fs from "node:fs";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { japaneseCatalogueTitle } from "../lib/japaneseTitleAliases.ts";

const file = process.argv[2];
if (!file) throw new Error("Pass metadata101.json as the first argument.");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const [targetResult, aliasResult] = await Promise.all([
  admin.from("catalogue_discovery_targets").select("id,title_english,title_native,title_romaji,status,source_metadata").eq("discovery_source", "staff_fast_track").eq("language", "Japanese").eq("next_missing_volume", 1).limit(200),
  admin.from("catalogue_discovery_targets").select("title_english,title_native,title_romaji,series_key").not("title_native", "is", null).limit(5000),
]);
if (targetResult.error) throw targetResult.error;
if (aliasResult.error) throw aliasResult.error;
const targets = targetResult.data;
const aliases = aliasResult.data;
// Search hints only. A matching string does not authorize staging or approval.
const researchAliases = {
  "Baki the Grappler": "グラップラー刃牙",
  "Black Butler": "黒執事",
  "Chibi Maruko-chan": "ちびまる子ちゃん",
  "Cooking Papa": "クッキングパパ",
  "Crayon Shin-chan": "クレヨンしんちゃん",
  "Crest of the Royal Family": "王家の紋章",
  "Dokaben": "ドカベン",
  "Doraemon": "ドラえもん",
  "Dragon Quest: The Adventure of Dai": "ドラゴンクエスト ダイの大冒険",
  "Fisherman Sanpei": "釣りキチ三平",
  "Frieren: Beyond Journey's End": "葬送のフリーレン",
  "Gintama": "銀魂",
  "Glass Mask": "ガラスの仮面",
  "Golgo 13": "ゴルゴ13",
  "Hell Teacher: Jigoku Sensei Nube": "地獄先生ぬ～べ～",
  "Inuyasha": "犬夜叉",
  "Itazura na Kiss": "イタズラなKiss",
  "Kaze Densetsu: Bukkomi no Taku": "特攻の拓",
  "Kimi ni Todoke": "君に届け",
  "KochiKame: Tokyo Beat Cops": "こちら葛飾区亀有公園前派出所",
  "Kosaku Shima": "課長島耕作",
  "Kyo Kara Ore Wa!!": "今日から俺は!!",
  "Minami no Teio": "ミナミの帝王",
  "Oishinbo": "美味しんぼ",
  "Ranma 1/2": "らんま1/2",
  "Rokudenashi Blues": "ろくでなしBLUES",
  "Salary Man Kintaro": "サラリーマン金太郎",
  "Sangokushi": "三国志",
  "Sazae-san": "サザエさん",
  "Shizukanaru Don": "静かなるドン",
  "Shonan Junai Gumi": "湘南純愛組!",
  "Shoot!": "シュート!",
  "Shura no Mon": "修羅の門",
  "Space Brothers": "宇宙兄弟",
  "Super Radical Gag Family": "浦安鉄筋家族",
  "The Apothecary Diaries": "薬屋のひとりごと",
  "The Chef": "ザ・シェフ",
  "The Kindaichi Case Files": "金田一少年の事件簿",
  "The Silent Service": "沈黙の艦隊",
  "Urusei Yatsura": "うる星やつら",
  "Yowamushi Pedal": "弱虫ペダル",
  "Yu-Gi-Oh!": "遊☆戯☆王",
};
function key(value) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[×✕]/g, "x").replace(/[^\p{L}\p{N}]+/gu, "");
}
function textValues(value) {
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (typeof value === "string") return [value];
  if (value && typeof value === "object" && typeof value["@value"] === "string") return [value["@value"]];
  return [];
}
const lookup = new Map();
for (const target of targets) {
  const names = new Set([target.title_english, target.title_native, target.title_romaji,
    japaneseCatalogueTitle(target.title_english), researchAliases[target.title_english],
    ...(target.source_metadata?.aliases ?? [])].filter(Boolean));
  const targetNames = new Set([...names].map(key));
  for (const alias of aliases) {
    if ([alias.title_english, alias.title_romaji, alias.series_key].some((name) => targetNames.has(key(name)))) {
      if (alias.title_native) names.add(alias.title_native);
    }
  }
  for (const name of names) {
    const k = key(name);
    if (!k) continue;
    const list = lookup.get(k) ?? [];
    list.push(target.title_english);
    lookup.set(k, list);
  }
}
const found = new Map(targets.map((target) => [target.title_english, []]));
let count = 0;
let capture = false;
let lines = [];
for await (const line of readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity })) {
  if (line === "    {") { capture = true; lines = [line]; continue; }
  if (!capture) continue;
  lines.push(line);
  if (line !== "    }," && line !== "    }") continue;
  const row = JSON.parse(lines.join("\n").replace(/,\s*$/, ""));
  capture = false;
  lines = [];
  if (row["@type"] !== "class:MangaBook" || row["schema:genre"] !== "マンガ単行本"
    || !/^(?:vol(?:ume)?\.?\s*)?0?1(?:\.0)?$/i.test(String(row["schema:volumeNumber"] ?? "").normalize("NFKC").trim())
    || row["schema:inLanguage"] !== "日本語") continue;
  count++;
  const names = textValues(row["schema:name"]);
  const hits = new Set(names.flatMap((name) => [name, name.split(/\s+=\s+/u)[0]])
    .flatMap((name) => lookup.get(key(name)) ?? []));
  for (const title of hits) {
    found.get(title).push({ id: row["schema:identifier"], label: row["rdfs:label"], names,
      isbn: row["schema:isbn"], publisher: row["schema:publisher"], sourceUrl: row["ma:dataUrl"],
      date: row["schema:datePublished"], brand: row["schema:brand"] });
  }
}
const results = targets.map((target) => ({ target: target.title_english, status: target.status,
  matches: found.get(target.title_english).sort((a, b) => String(a.date ?? "9999").localeCompare(String(b.date ?? "9999"))).slice(0, 8) }));
console.log(JSON.stringify({ targetCount: targets.length, japaneseMangaVolumeOne: count,
  matchedTargets: results.filter((row) => row.matches.length).length,
  unmatched: results.filter((row) => !row.matches.length).map((row) => row.target),
  results: process.argv.includes("--details")
    ? results.filter((row) => row.matches.length)
    : results.filter((row) => row.matches.length).map((row) => ({
      target: row.target, status: row.status, count: found.get(row.target).length,
      first: row.matches[0] && { label: row.matches[0].label, isbn: row.matches[0].isbn,
        publisher: row.matches[0].publisher, date: row.matches[0].date },
    })) }, null, 2));
