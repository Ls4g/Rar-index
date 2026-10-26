import assert from "node:assert/strict";
import { findShueishaCover, shueishaCoverImageUrl } from "../lib/shueishaCover.ts";

const target = {
  title: "CITY HUNTER 1", series: "City Hunter", volumeNumber: "1",
  language: "Japanese", publisher: "Shueisha", isbn13: "9784086171618",
  variantName: null, printingNumber: null,
};
const image = new Uint8Array(20_000);
image.set([0xff, 0xd8, 0xff, 0xe0]);
const response = (status = 200, body = image) => ({
  ok: status === 200, status,
  arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
});

assert.equal(shueishaCoverImageUrl("978-4-08-617161-8"),
  "https://dosbg3xlm0x1t.cloudfront.net/images/items/9784086171618/500/9784086171618.jpg");
assert.equal(shueishaCoverImageUrl("9784086171619"), null, "bad ISBN checksum must be refused");

let called = 0;
const fetchImage = async (url) => {
  called += 1;
  assert.match(String(url), /\/9784086171618\/(?:500|240)\/9784086171618\.jpg$/);
  return response();
};
const found = await findShueishaCover(target, fetchImage);
assert.equal(found.candidates.length, 1);
assert.equal(found.candidates[0].candidateIsbn13, target.isbn13);
assert.equal(found.candidates[0].sourceName, "Shueisha Direct");
assert.equal(found.candidates[0].candidateTitle, null, "unread publisher metadata must not be invented");
assert.match(found.candidates[0].matchReasons.join(" "), /before approval/);
assert.equal(called, 1);

for (const wrong of [
  { publisher: "Kodansha" }, { language: "English" },
  { variantName: "Gold Foil" }, { printingNumber: 3 }, { isbn13: "9784086171619" },
]) {
  const rejected = await findShueishaCover({ ...target, ...wrong }, async () => {
    throw new Error("An ineligible edition must not call Shueisha");
  });
  assert.equal(rejected.candidates.length, 0);
}

const fallback = await findShueishaCover(target, async (url) =>
  response(String(url).includes("/500/") ? 403 : 200));
assert.match(fallback.candidates[0].coverImageUrl, /\/240\//);
assert.equal((await findShueishaCover(target, async () => response(403))).candidates.length, 0);
assert.equal((await findShueishaCover(target, async () => response(200, new TextEncoder().encode("x".repeat(10_000))))).candidates.length, 0);
await assert.rejects(() => findShueishaCover(target, async () => response(500)), /Shueisha image CDN returned 500/);

console.log("Shueisha cover source: eligibility, image checks, fallback, and provenance passed");
