import assert from "node:assert/strict";
import { assessCoverCandidate } from "../lib/coverCandidateMatch.ts";

const target = {
  title: "HUNTER x HUNTER 1",
  series: "HUNTER x HUNTER",
  volumeNumber: "1",
  language: "Japanese",
  publisher: "Shueisha",
  isbn13: "9784088725710",
};

const exact = assessCoverCandidate(target, {
  title: "HUNTER x HUNTER Vol. 1",
  language: "ja",
  publisher: "Shueisha",
  isbn13: "978-4-08-872571-0",
});
assert.equal(exact.eligible, true);
assert.equal(exact.confidence, "strong");

const titleSparse = assessCoverCandidate(target, {
  title: null,
  language: null,
  publisher: null,
  isbn13: "9784088725710",
});
assert.equal(titleSparse.eligible, true);
assert.equal(titleSparse.confidence, "partial");

const wrongIsbn = assessCoverCandidate(target, {
  title: "HUNTER x HUNTER Vol. 1",
  language: "ja",
  publisher: "Shueisha",
  isbn13: "9784088725727",
});
assert.equal(wrongIsbn.eligible, false);
assert.equal(wrongIsbn.confidence, "conflict");

const wrongVolume = assessCoverCandidate(target, {
  title: "HUNTER x HUNTER Vol. 2",
  language: "ja",
  publisher: "Shueisha",
  isbn13: "9784088725710",
});
assert.equal(wrongVolume.eligible, false);
assert.equal(wrongVolume.confidence, "conflict");

const wrongLanguage = assessCoverCandidate(target, {
  title: "HUNTER x HUNTER Vol. 1",
  language: "English",
  publisher: "Shueisha",
  isbn13: "9784088725710",
});
assert.equal(wrongLanguage.eligible, false);
assert.equal(wrongLanguage.confidence, "conflict");

console.log("cover candidate scoring: 5/5 passed");
