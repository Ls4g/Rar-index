// The catalogue matcher must not stage a set, a bundle or a companion product
// as though it were one volume of the manga. Run with:
//   node --experimental-strip-types scripts/test-catalogue-single-volume.mjs
//
// Every rejected example below is a real record a human threw out of the
// catalogue review queue. The accepted ones are real records they approved,
// and they are here to stop a future tightening from quietly costing genuine
// editions -- the failure that matters most, because it is silent.
import { candidateIsNotASingleVolume, candidateMatchesDiscoveryTarget } from "../lib/catalogueCurator.ts";

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${expected}, got ${actual})`}`);
}

console.log("\n--- bundles and sets staff rejected ---");
check("a numbered bundle set", candidateIsNotASingleVolume("Jujutsu Kaisen Vol. 1,2,3,4,5,6 Bundle Set (6 Book Collection)", "1"), true);
check("a collection set with a range", candidateIsNotASingleVolume("Dandadan, Vol. 1-9, Collection Set 9 Books Series, by Yukinobu Tatsu", "1"), true);
check("a plain volume range", candidateIsNotASingleVolume("Berserk Deluxe Volume 1-5", "1"), true);
check("a box set", candidateIsNotASingleVolume("Naruto Box Set 1", "1"), true);
check("a complete series", candidateIsNotASingleVolume("Death Note Complete Series", "1"), true);

console.log("\n--- companion products staff rejected ---");
check("a colouring book", candidateIsNotASingleVolume("Demon Slayer : Kimetsu No Yaiba, Vol 1, Coloring Book", "1"), true);
check("British spelling too", candidateIsNotASingleVolume("One Piece Colouring Book", "1"), true);
check("an art book", candidateIsNotASingleVolume("Attack on Titan Artbook", "1"), true);
check("a fan book", candidateIsNotASingleVolume("Bleach Official Fan Book", "1"), true);

console.log("\n--- ordinary volumes must still pass ---");
check("a normal volume", candidateIsNotASingleVolume("One Piece, Vol. 1", "1"), false);
check("a volume with a subtitle", candidateIsNotASingleVolume("Naruto, Vol. 2: The Worst Client", "2"), false);
check("a Japanese volume", candidateIsNotASingleVolume("ONE PIECE 1", "1"), false);
check("an empty title is not a set", candidateIsNotASingleVolume("", "1"), false);
check("a null title is not a set", candidateIsNotASingleVolume(null, "1"), false);

console.log("\n--- the word 'collection' alone is not a verdict on a real volume ---");
// "Collector's Edition" is a single book. Only lot wording should bin it.
check("a collector's edition volume", candidateIsNotASingleVolume("Vagabond, Vol. 1 (VIZBIG Edition)", "1"), false);

console.log("\n--- end to end through the matcher ---");
const target = {
  key: "t", source: "open_library", query: "Jujutsu Kaisen",
  title: "Jujutsu Kaisen Vol. 1", series: "Jujutsu Kaisen", volumeNumber: "1",
  language: "English", publisher: null, isbn13: null, requestId: null, reason: "lane_established",
};
check("the bundle is refused by the matcher", candidateMatchesDiscoveryTarget({
  candidate_title: "Jujutsu Kaisen Vol. 1,2,3,4,5,6 Bundle Set (6 Book Collection)",
  candidate_isbn_13: "9798897222100", candidate_publisher: "Viz", candidate_language: "English",
  candidate_volume_number: "1",
}, target), false);
check("the real volume is still accepted", candidateMatchesDiscoveryTarget({
  candidate_title: "Jujutsu Kaisen, Vol. 1", candidate_isbn_13: "9781974710027",
  candidate_publisher: "Viz", candidate_language: "English", candidate_volume_number: "1",
}, target), true);

// A box set can legitimately carry the ISBN a request asked for, so the set
// check has to run BEFORE the ISBN shortcut or the set gets staged anyway.
const isbnTarget = { ...target, isbn13: "9798897222100" };
check("a matching ISBN cannot rescue a box set", candidateMatchesDiscoveryTarget({
  candidate_title: "Jujutsu Kaisen Vol. 1-6 Box Set", candidate_isbn_13: "9798897222100",
  candidate_publisher: "Viz", candidate_language: "English", candidate_volume_number: "1",
}, isbnTarget), false);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
