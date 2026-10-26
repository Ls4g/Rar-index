import assert from "node:assert/strict";
import { findPenguinRandomHouseCover } from "../lib/penguinRandomHouseCover.ts";
import { findKodamaCover } from "../lib/kodamaCover.ts";
import { findOpenBdCover } from "../lib/openBdCover.ts";

const jpeg = new Uint8Array(12_000);
jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
const webp = new Uint8Array(12_000);
webp.set(new TextEncoder().encode("RIFF"), 0);
webp.set(new TextEncoder().encode("WEBP"), 8);
const imageResponse = (body = jpeg) => ({ ok: true, status: 200, arrayBuffer: async () => body.buffer });

const gachiakuta = {
  title: "Gachiakuta 1", series: "Gachiakuta", volumeNumber: "1",
  language: "English", publisher: "Kodansha America, Incorporated", isbn13: "9798888770207",
};
const productUrl = "https://www.penguinrandomhouse.com/books/741313/gachiakuta-1-by-kei-urana/9798888770207/";
const productHtml = '<meta property="og:title" content="Gachiakuta 1 by Kei Urana: 9798888770207 | PenguinRandomHouse.com: Books" />'
  + '<meta property="og:image" content="https://images1.penguinrandomhouse.com/smedia/9798888770207" />';
let prhRequests = 0;
const prhFetch = async (url) => {
  prhRequests += 1;
  if (String(url).includes("/search/site")) return { ok: true, status: 200, url: productUrl, text: async () => productHtml };
  assert.equal(String(url), "https://images1.penguinrandomhouse.com/smedia/9798888770207");
  return imageResponse();
};
const prh = await findPenguinRandomHouseCover(gachiakuta, prhFetch);
assert.equal(prhRequests, 2);
assert.equal(prh.candidates.length, 1);
assert.equal(prh.candidates[0].sourceRecordUrl, productUrl);
assert.equal(prh.candidates[0].candidateIsbn13, gachiakuta.isbn13);
assert.equal(prh.candidates[0].candidateTitle, "Gachiakuta 1 by Kei Urana");
assert.equal((await findPenguinRandomHouseCover({ ...gachiakuta, variantName: "Special cover" }, async () => { throw Error("no request"); })).candidates.length, 0);
assert.equal((await findPenguinRandomHouseCover(gachiakuta, async () => ({ ok: true, status: 200,
  url: "https://www.penguinrandomhouse.com/search/site?q=9798888770207", text: async () => productHtml }))).candidates.length, 0);
assert.equal((await findPenguinRandomHouseCover(gachiakuta, async (url) => String(url).includes("search/site")
  ? { ok: true, status: 200, url: productUrl.replace("9798888770207", "9798888770948"), text: async () => productHtml }
  : imageResponse())).candidates.length, 0);
assert.equal((await findPenguinRandomHouseCover(gachiakuta, async (url) => String(url).includes("search/site")
  ? { ok: true, status: 200, url: productUrl, text: async () => productHtml }
  : imageResponse(new TextEncoder().encode("not an image".repeat(1_000))))).candidates.length, 0);

const baki = {
  title: "Baki the Grappler Vol. 1", series: "Baki the Grappler", volumeNumber: "1",
  language: "English", publisher: "Kodama Tales Inc.", isbn13: "9781966523000",
};
const kodamaUrl = "https://kodama-tales.com/project/baki-1/";
const hits = [
  { title: "BAKI &#8211; VOLUME 10", url: "https://kodama-tales.com/project/baki-volume-10/", subtype: "project" },
  { title: "BAKI &#8211; VOLUME 1", url: kodamaUrl, subtype: "project" },
  { title: "BAKI - VOLUME 1 BOX SET", url: "https://kodama-tales.com/products/baki-box-set/", subtype: "wps_products" },
];
const kodamaHtml = '<meta property="og:title" content="BAKI - VOLUME 1 &bull; Kodama" />'
  + '<meta property="og:image" content="https://kodama-tales.com/wp-content/uploads/2025/07/book-cover-1.webp" />';
let kodamaRequests = 0;
const kodamaFetch = async (url) => {
  kodamaRequests += 1;
  if (String(url).includes("wp-json")) return { ok: true, status: 200, json: async () => hits };
  if (String(url) === kodamaUrl) return { ok: true, status: 200, url: kodamaUrl, text: async () => kodamaHtml };
  return imageResponse(webp);
};
const foundBaki = await findKodamaCover(baki, kodamaFetch);
assert.equal(kodamaRequests, 3);
assert.equal(foundBaki.candidates.length, 1);
assert.equal(foundBaki.candidates[0].candidateIsbn13, null, "Kodama never supplied an ISBN");
assert.equal(foundBaki.candidates[0].matchConfidence, "partial");
assert.match(foundBaki.candidates[0].matchReasons.join(" "), /verify the exact physical edition/i);
assert.equal((await findKodamaCover({ ...baki, publisher: "Kodansha" }, async () => { throw Error("no request"); })).candidates.length, 0);
assert.equal((await findKodamaCover({ ...baki, volumeNumber: "2" }, async () => ({ ok: true, status: 200, json: async () => hits }))).candidates.length, 0);
assert.equal((await findKodamaCover(baki, async () => ({ ok: true, status: 200, json: async () => [...hits, hits[1]] }))).candidates.length, 0);

const japanese = {
  title: "ブルーロック 1", series: "ブルーロック", volumeNumber: "1",
  language: "Japanese", publisher: "Kodansha", isbn13: "9784065134009",
};
const openBdRecord = {
  candidate_title: "ブルーロック = BLUELOCK. 1", candidate_publisher: "講談社",
  candidate_language: "Japanese", candidate_isbn_13: japanese.isbn13,
  candidate_cover_image_url: "https://cover.openbd.jp/9784065134009.jpg",
  source_record_url: "https://api.openbd.jp/v1/get?isbn=9784065134009",
};
const openBd = await findOpenBdCover(japanese, async () => [openBdRecord]);
assert.equal(openBd.candidates.length, 1);
assert.equal(openBd.candidates[0].candidateIsbn13, japanese.isbn13);
assert.equal((await findOpenBdCover(japanese, async () => [{ ...openBdRecord, candidate_cover_image_url: null }])).candidates.length, 0);
assert.equal((await findOpenBdCover(japanese, async () => [{ ...openBdRecord, candidate_isbn_13: "9784065134016" }])).candidates.length, 0);
assert.equal((await findOpenBdCover({ ...japanese, language: "English" }, async () => { throw Error("no request"); })).candidates.length, 0);

console.log("Cover source search: PRH ISBN, Kodama title, OpenBD ISBN, and refusal guards passed");
