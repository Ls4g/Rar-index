// VIZ covers, addressed by ISBN.
//
//   node --experimental-strip-types scripts/test-viz-cover.mjs
//
// No network. The CDN is stubbed, because what needs guarding here is the
// arithmetic and the refusals, not whether VIZ is up.
//
// The refusals are the point. An ISBN-addressed image is the WRONG artwork for
// a variant edition -- three of RAR's ISBNs carry two editions each, and the
// Gold Foil One Piece vol 1 exists precisely because its cover differs. Handing
// a reviewer the ordinary cover and inviting them to approve it would put a
// knowingly wrong image in the catalogue, so it must never be offered.
import assert from "node:assert/strict";
import {
  findVizCover,
  findVizCoverImage,
  isbn10FromIsbn13,
  isbnAddressableCover,
  looksLikeImage,
  vizCoverImageUrl,
} from "../lib/vizCover.ts";

function target(overrides = {}) {
  return {
    title: "One Piece, Vol. 1",
    series: "One Piece",
    volumeNumber: "1",
    language: "English",
    publisher: "VIZ Media",
    isbn13: "9781569319017",
    variantName: null,
    printingNumber: null,
    ...overrides,
  };
}

// A stub standing in for VIZ's product CDN.
//
// The default deliberately mimics what VIZ really sends: a valid JPEG labelled
// "binary/octet-stream". An earlier version of this stub returned a tidy
// "image/jpeg", which let a content-type check pass every test here while
// rejecting all ten real covers in production. The stub now has to lie the way
// the real thing lies.
function imageBody(bytes, signature = [0xff, 0xd8, 0xff, 0xe0]) {
  const body = new Uint8Array(bytes);
  body.set(signature, 0);
  return body;
}

function cdn({ status = 200, type = "binary/octet-stream", body } = {}) {
  const payload = body ?? imageBody(120_000);
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === "content-type" ? type : null) },
    arrayBuffer: async () => payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  });
}

const checks = [];
function check(label, fn) {
  try { fn(); checks.push({ label, ok: true }); }
  catch (error) { checks.push({ label, ok: false, error: error.message }); }
}
async function checkAsync(label, fn) {
  try { await fn(); checks.push({ label, ok: true }); }
  catch (error) { checks.push({ label, ok: false, error: error.message }); }
}

check("ISBN-10 is derived correctly from real catalogue ISBNs", () => {
  // Each pair taken from a cover RAR already holds, where the stored image
  // filename is the ISBN-10 -- so these are observed, not computed by hand.
  const pairs = [
    ["9781421587189", "1421587181"],
    ["9781569319208", "1569319200"],
    ["9781569319215", "1569319219"],
    ["9781974758913", "1974758915"],
  ];
  for (const [isbn13, expected] of pairs) {
    assert.equal(isbn10FromIsbn13(isbn13), expected, `${isbn13} should give ${expected}`);
  }
});

check("a 979 ISBN has no ISBN-10 and is refused rather than approximated", () => {
  // Gachiakuta vol 2 is 9798888770948. Dropping the prefix and recomputing
  // would produce a number that addresses a different book, or nothing.
  assert.equal(isbn10FromIsbn13("9798888770948"), null);
  assert.equal(vizCoverImageUrl("9798888770948"), null);
});

check("malformed ISBNs produce no URL", () => {
  for (const bad of [null, undefined, "", "978", "97815693190171", "abcdefghijklm"]) {
    assert.equal(vizCoverImageUrl(bad), null, `${JSON.stringify(bad)} must not produce a URL`);
  }
});

check("a variant edition is refused, because its ISBN names the plain cover", () => {
  const verdict = isbnAddressableCover(target({ variantName: "Gold Foil" }));
  assert.equal(verdict.usable, false);
  assert.match(verdict.reason, /Gold Foil/);
  assert.match(verdict.reason, /photograph of a real copy/);
});

check("a later printing is refused for the same reason", () => {
  assert.equal(isbnAddressableCover(target({ printingNumber: 9 })).usable, false);
  // A first printing is the edition the ISBN actually names, so it is fine.
  assert.equal(isbnAddressableCover(target({ printingNumber: 1 })).usable, true);
  assert.equal(isbnAddressableCover(target()).usable, true);
});

await checkAsync("a real image becomes a candidate carrying the target's own ISBN", async () => {
  const result = await findVizCover(target(), cdn());
  assert.equal(result.candidates.length, 1);
  const candidate = result.candidates[0];
  assert.equal(candidate.sourceName, "VIZ Media");
  assert.equal(candidate.candidateIsbn13, "9781569319017");
  const isbn10 = isbn10FromIsbn13("9781569319017");
  assert.equal(candidate.externalId, isbn10, "the ISBN-10 is VIZ's own product key");
  assert.ok(candidate.coverImageUrl.endsWith(`${isbn10}.jpg`));
  assert.ok(candidate.matchScore >= 60, `expected at least the exact-ISBN score, got ${candidate.matchScore}`);
});

await checkAsync("the candidate admits no VIZ record was read", async () => {
  // The reviewer is confirming artwork, not metadata. Saying so is the
  // difference between a candidate and a claim.
  const result = await findVizCover(target(), cdn());
  const reasons = result.candidates[0].matchReasons.join(" ");
  assert.match(reasons, /No VIZ product record was read/);
  assert.match(reasons, /check the artwork matches this volume/);
});

await checkAsync("a variant edition yields no candidate at all", async () => {
  // Not merely a low score -- nothing, so it cannot be approved by accident.
  const result = await findVizCover(target({ variantName: "Gold Foil" }), cdn());
  assert.equal(result.candidates.length, 0);
  assert.match(result.emptyReason, /shares its ISBN/);
});

await checkAsync("403 means VIZ does not publish it, and yields nothing", async () => {
  const result = await findVizCover(target(), cdn({ status: 403 }));
  assert.equal(result.candidates.length, 0);
  assert.match(result.emptyReason, /does not publish this ISBN/);
});

await checkAsync("a tiny response is not offered as cover art", async () => {
  // A 200 with a few hundred bytes is a placeholder or an error page.
  const result = await findVizCover(target(), cdn({ body: imageBody(400) }));
  assert.equal(result.candidates.length, 0);
  assert.match(result.emptyReason, /too small to be cover art/);
});

await checkAsync("an unlabelled image is still accepted, because VIZ does not label them", async () => {
  // The real CDN sends "binary/octet-stream" or no content type at all. A
  // header check here rejected every genuine cover.
  for (const type of ["binary/octet-stream", null, "application/octet-stream"]) {
    const result = await findVizCover(target(), cdn({ type }));
    assert.equal(result.candidates.length, 1, `content-type ${JSON.stringify(type)} should not disqualify a real JPEG`);
  }
});

await checkAsync("an HTML page is rejected however it is labelled", async () => {
  // The bytes decide, so a page claiming to be a JPEG still fails.
  const html = new TextEncoder().encode(`<!doctype html><title>Not found</title>${"x".repeat(20_000)}`);
  const result = await findVizCover(target(), cdn({ type: "image/jpeg", body: html }));
  assert.equal(result.candidates.length, 0);
  assert.match(result.emptyReason, /not an image/);
});

check("the image signature check accepts JPEG, PNG and WebP and nothing else", () => {
  assert.equal(looksLikeImage(imageBody(64, [0xff, 0xd8, 0xff])), true, "JPEG");
  assert.equal(looksLikeImage(imageBody(64, [0x89, 0x50, 0x4e, 0x47])), true, "PNG");
  const webp = new Uint8Array(64);
  webp.set(new TextEncoder().encode("RIFF"), 0);
  webp.set(new TextEncoder().encode("WEBP"), 8);
  assert.equal(looksLikeImage(webp), true, "WebP");
  assert.equal(looksLikeImage(new TextEncoder().encode("<!doctype html>")), false, "HTML");
  assert.equal(looksLikeImage(new Uint8Array(4)), false, "too short to judge");
});

await checkAsync("a server fault is raised, not silently treated as 'no cover'", async () => {
  // A 500 must not be recorded as "VIZ has nothing", which would park the
  // edition for a day on the strength of an outage.
  await assert.rejects(() => findVizCoverImage("9781569319017", cdn({ status: 500 })), /500/);
});

for (const result of checks) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}`);
  if (!result.ok) console.log(`      ${result.error}`);
}
const failed = checks.filter((result) => !result.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} checks passed.`);
if (failed) process.exitCode = 1;
