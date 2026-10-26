// Stream the staff-supplied MADB JSON-LD export without loading the 670 MB file.
// Usage: node scripts/audit-madb-japanese-vol1.mjs <metadata101.json> [search terms...]
import fs from "node:fs";
import readline from "node:readline";

const [file, ...terms] = process.argv.slice(2);
if (!file) throw new Error("Pass the MADB JSON-LD file path.");
const wanted = terms.map((term) => term.normalize("NFKC").toLocaleLowerCase());
const counts = { records: 0, mangaBooks: 0, mangaVolumeOne: 0, japaneseMangaVolumeOne: 0, withIsbn: 0 };
const matches = [];
let capture = false;
let lines = [];

function textValues(value) {
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (typeof value === "string") return [value];
  if (value && typeof value === "object" && typeof value["@value"] === "string") return [value["@value"]];
  return [];
}

function inspect(record) {
  counts.records++;
  if (record["@type"] !== "class:MangaBook" || record["schema:genre"] !== "マンガ単行本") return;
  counts.mangaBooks++;
  if (!/^(?:vol(?:ume)?\.?\s*)?0?1(?:\.0)?$/i.test(String(record["schema:volumeNumber"] ?? "").normalize("NFKC").trim())) return;
  counts.mangaVolumeOne++;
  if (record["schema:inLanguage"] !== "日本語") return;
  counts.japaneseMangaVolumeOne++;
  if (record["schema:isbn"]) counts.withIsbn++;
  const names = [record["rdfs:label"], ...textValues(record["schema:name"])].filter(Boolean);
  if (wanted.length && !wanted.some((term) => names.some((name) => name.normalize("NFKC").toLocaleLowerCase().includes(term)))) return;
  if (matches.length >= (wanted.length ? 200 : 25)) return;
  matches.push({ id: record["schema:identifier"], label: record["rdfs:label"], names, isbn: record["schema:isbn"], publisher: record["schema:publisher"], sourceUrl: record["ma:dataUrl"], date: record["schema:datePublished"] });
}

for await (const line of readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity })) {
  if (line === "    {") { capture = true; lines = [line]; continue; }
  if (!capture) continue;
  lines.push(line);
  if (line !== "    }," && line !== "    }") continue;
  const raw = lines.join("\n").replace(/,\s*$/, "");
  inspect(JSON.parse(raw));
  capture = false;
  lines = [];
}

console.log(JSON.stringify({ counts, matches }, null, 2));
