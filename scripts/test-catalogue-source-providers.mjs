import assert from "node:assert/strict";
import { searchOpenBdCatalogue } from "../lib/catalogueSources.ts";
import { createGoogleBooksBatchGate, googleBooksRequestUrl } from "../lib/coverProviderPolicy.ts";

const originalFetch = globalThis.fetch;
let requestedUrl = "";
try {
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify([{
      summary: {
        isbn: "9784088725093",
        title: "ONE PIECE 1",
        volume: "1",
        series: "Jump Comics",
        publisher: "Shueisha",
        pubdate: "19971229",
        cover: "http://example.test/cover.jpg",
        author: "Eiichiro Oda",
      },
      onix: { RecordReference: "9784088725093", DescriptiveDetail: { Language: [{ LanguageCode: "jpn" }] } },
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const candidates = await searchOpenBdCatalogue("978-4-08-872509-3");
  assert.match(requestedUrl, /isbn=9784088725093/);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].source_name, "OpenBD");
  assert.equal(candidates[0].candidate_isbn_13, "9784088725093");
  assert.equal(candidates[0].candidate_language, "Japanese");
  assert.equal(candidates[0].candidate_release_date, "1997-12-29");
  assert.equal(candidates[0].candidate_cover_image_url, "https://example.test/cover.jpg");

  globalThis.fetch = async () => new Response(JSON.stringify([{ summary: { isbn: "9784080000000", title: "Wrong book" } }]), { status: 200 });
  assert.deepEqual(await searchOpenBdCatalogue("9784088725093"), []);
  await assert.rejects(() => searchOpenBdCatalogue("One Piece 1"), /needs a Japanese ISBN/);
} finally {
  globalThis.fetch = originalFetch;
}

const noKey = createGoogleBooksBatchGate(undefined);
assert.equal(noKey.canRequest(), false);
assert.equal(noKey.skipReason(), "not_configured");

const gate = createGoogleBooksBatchGate("server-key");
assert.equal(gate.canRequest(), true);
assert.match(googleBooksRequestUrl("9784088725093", gate.apiKey), /key=server-key/);
gate.recordStatus(429);
assert.equal(gate.canRequest(), false);
assert.equal(gate.skipReason(), "rate_limited");

console.log("Catalogue provider policy checks passed.");
