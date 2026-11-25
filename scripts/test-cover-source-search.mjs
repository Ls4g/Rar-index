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

// Dark Horse: ISBN search -> one product page that prints the ISBN -> cover.
{
  const { findDarkHorseCover, darkHorseProductLinks } = await import("../lib/darkHorseCover.ts");
  const astro = { title: "Astro Boy Volume 21", series: "Astro Boy", volumeNumber: "21", language: "English", publisher: "Dark Horse Comics", isbn13: "9781569719022" };
  const product = "https://www.darkhorse.com/books/12-344/astro-boy-volume-21-tpb/";
  const searchHtml = '<a href="/Books/12-344/Astro-Boy-Volume-21-TPB">Astro Boy Volume 21 TPB</a><a href="/Books/12-344/Astro-Boy-Volume-21-TPB">again</a><a href="/Search/browse/9781569719022/">See all</a>';
  assert.deepEqual(darkHorseProductLinks(searchHtml), [product]);
  const pageHtml = '<meta property="og:title" content="Astro Boy Volume 21 TPB :: Profile :: Dark Horse Comics" />'
    + '<meta property="og:image" content="https://images.darkhorse.com/covers/600/12/12344.jpg" /><dd>9781569719022</dd>';
  const dhFetch = async (url) => String(url).includes("/Search/") ? { ok: true, status: 200, text: async () => searchHtml }
    : String(url) === product ? { ok: true, status: 200, text: async () => pageHtml } : imageResponse(jpeg);
  const found = await findDarkHorseCover(astro, dhFetch);
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0].matchConfidence, "strong");
  assert.equal(found.candidates[0].candidateIsbn13, "9781569719022");
  assert.equal(found.candidates[0].coverImageUrl, "https://images.darkhorse.com/covers/600/12/12344.jpg");
  assert.equal(found.candidates[0].candidateTitle, "Astro Boy Volume 21 TPB");
  // The page must print the same ISBN.
  const wrongIsbn = async (url) => String(url).includes("/Search/") ? { ok: true, status: 200, text: async () => searchHtml }
    : String(url) === product ? { ok: true, status: 200, text: async () => pageHtml.replace("9781569719022", "9781569719039") } : imageResponse(jpeg);
  assert.equal((await findDarkHorseCover(astro, wrongIsbn)).candidates.length, 0);
  // Other publishers are never searched.
  assert.equal((await findDarkHorseCover({ ...astro, publisher: "VIZ Media" }, async () => { throw Error("no request"); })).candidates.length, 0);
  // Several products for one ISBN is left to staff.
  const twoHits = searchHtml + '<a href="/Books/99-1/Other-TPB">Other</a>';
  assert.equal((await findDarkHorseCover(astro, async () => ({ ok: true, status: 200, text: async () => twoHits }))).candidates.length, 0);
  // Cover must come from Dark Horse's cover server.
  const offHost = async (url) => String(url).includes("/Search/") ? { ok: true, status: 200, text: async () => searchHtml }
    : { ok: true, status: 200, text: async () => pageHtml.replace("images.darkhorse.com", "example.com") };
  assert.equal((await findDarkHorseCover(astro, offHost)).candidates.length, 0);
  console.log("dark horse cover search: ok");
}

// Simon & Schuster: /books/<ISBN> -> its product page -> Book record with the
// same ISBN -> the largest cover on its own CDN.
{
  const { findSimonSchusterCover, simonSchusterSizedCover } = await import("../lib/simonSchusterCover.ts");
  const claymore = { title: "Claymore, Vol. 15", series: "Claymore", volumeNumber: "15", language: "English", publisher: "VIZ Media", isbn13: "9781421531496" };
  const page = "https://www.simonandschuster.com/books/Claymore-Vol-15/Norihiro-Yagi/Claymore/9781421531496";
  const lg = "https://d28hgpri8am2if.cloudfront.net/book_images/onix/cvr9781421531496/claymore-vol-15-9781421531496_lg.jpg";
  const hr = lg.replace("_lg.jpg", "_hr.jpg");
  assert.equal(simonSchusterSizedCover(lg, "9781421531496", "_hr"), hr);
  assert.equal(simonSchusterSizedCover(lg, "9781421531497", "_hr"), null, "another ISBN's folder is refused");
  const html = `<meta property="og:image" content="${lg}" />`
    + '<script type="application/ld+json">{"@type":"Book","isbn":"9781421581712","name":"Claymore, Vol. 27"}</script>'
    + '<script type="application/ld+json">{"@context":"http://schema.org","@type":"Book","isbn":"9781421531496","name":"Claymore, Vol. 15"}</script>';
  const requested = [];
  const ssFetch = async (url) => {
    requested.push(String(url));
    if (String(url).endsWith("/books/9781421531496")) return { ok: true, status: 200, url: page, text: async () => html };
    return imageResponse(jpeg);
  };
  const found = await findSimonSchusterCover(claymore, ssFetch);
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0].coverImageUrl, hr, "largest size first");
  assert.equal(found.candidates[0].matchConfidence, "strong");
  assert.equal(found.candidates[0].candidateTitle, "Claymore, Vol. 15");
  // Falls back to the page's own size when the large one is missing.
  const noHr = async (url) => String(url).endsWith("/books/9781421531496") ? { ok: true, status: 200, url: page, text: async () => html }
    : String(url) === hr ? { ok: false, status: 403 } : imageResponse(jpeg);
  assert.equal((await findSimonSchusterCover(claymore, noHr)).candidates[0].coverImageUrl, lg);
  // The page's own Book record must carry the ISBN.
  const otherBook = async (url) => ({ ok: true, status: 200, url: page, text: async () => html.replace('"isbn":"9781421531496"', '"isbn":"9781421531403"') });
  assert.equal((await findSimonSchusterCover(claymore, otherBook)).candidates.length, 0);
  // A redirect to some other page is refused.
  const elsewhere = async () => ({ ok: true, status: 200, url: "https://www.simonandschuster.com/search/books", text: async () => html });
  assert.equal((await findSimonSchusterCover(claymore, elsewhere)).candidates.length, 0);
  // Japanese editions are not looked up.
  assert.equal((await findSimonSchusterCover({ ...claymore, language: "Japanese" }, async () => { throw Error("no request"); })).candidates.length, 0);
  console.log("simon & schuster cover search: ok");
}
