// What the daily sold search may close on its own, tested on the 23 results
// of the 13 November 2026 run (titles as eBay gave them, trimmed).
//
//   node --experimental-strip-types scripts/test-sold-search-auto-dismiss.mjs
//
// The rule being protected: automation may take a result out of the human
// queue only when the title cannot be the edition -- a lot or set, a magazine
// issue, another language, a sister series. A single wrong volume number is
// NOT enough: that day a listing titled "One Piece, Vol. 68" was the Vol. 13
// a reviewer verified from its photos. And nothing here may ever confirm.
import assert from "node:assert/strict";
import { autoDismissReasons, autoDismissedOutcomeRow, buildTitleSearchOutcomeRow, AUTO_DISMISS_REVIEWER } from "../lib/apifyListingIntake.ts";

const edition = (series, volume, language, publisher, extra = {}) => ({
  id: `${series}-${volume}`, title: `${series}, Vol. ${volume}`, series, volume_number: String(volume), language,
  isbn_13: null, publisher, format: "Paperback", printing_number: null, edition_statement: null, variant_name: null,
  collectible_type: "tankobon", ...extra,
});
const BERSERK = edition("Berserk", 8, "English", "Dark Horse Comics", { format: "Hardcover" });
const BLACK_CLOVER = edition("Black Clover", 1, "Japanese", "Shueisha");
const BLEACH = edition("Bleach", 7, "English", "VIZ Media");
const MARUKO = edition("Chibi Maruko-chan", 1, "Japanese", "Shueisha");
const NARUTO = edition("Naruto", 9, "English", "VIZ Media");
const ONE_PIECE = edition("One Piece", 13, "English", "VIZ Media");

// [edition, title, what a person decided, must auto-dismiss?]
const CASES = [
  [BERSERK, "Berserk Vol. 1, 2, 3, 4, 5, 6, 7, 8, 9 Paperback Manga English by Kentaro Miura", "rejected", true],
  [BERSERK, "Berserk Deluxe Edition Hardcover Volume 8 NM Dark Horse Comics Kentaro Miura", "rejected", false],
  [BERSERK, "Berserk Deluxe Volume 8", "rejected", false],
  [BERSERK, "Berserk Deluxe Edition Vol. 1–8 Complete Set | Vol. 4–8 Sealed | Dark Horse", "rejected", true],
  [BLACK_CLOVER, "Black Clover Vol 1 #1 First Print Japanese Manga W/ Obi", "verified", false],
  [BLACK_CLOVER, "BGS 9.6 Black Clover Vol. 1 1st Print Obi Comics Manga Books 2015 Japanese", "verified", false],
  [BLACK_CLOVER, "BGS 7.5 Weekly Shonen Jump 2015 Volume 12 Black Clover", "rejected", true],
  [BLACK_CLOVER, "Black Clover Manga Vol 38 Final + Guidebook 1", "rejected", false],
  [BLEACH, "Shonen Jump July 2008 Volume 6 Issue 7 Naruto Bleach", "rejected", true],
  [BLEACH, "Bleach Manga Book Lot Omnibus 3-in-1 English", "rejected", true],
  [BLEACH, "Bleach Manga Vol 41, 48, 60, 63, 65, 66, 70, 71", "rejected", true],
  [MARUKO, "Chibi Maruko-Chan Vol.1-18 + Bonus Japanese", "rejected", true],
  [MARUKO, "Chibi Maruko-chan Vol.1-18 Comic Manga Set", "rejected", true],
  [MARUKO, "Chibi Maruko-Chan Vol.1-18 Complete Full Set", "rejected", true],
  [MARUKO, "Chibi Maruko-Chan Vol.1-18 Complete Manga", "rejected", true],
  [NARUTO, "Shonen Jump Magazine Manga Vol 1 #2, 3, 4, 5", "rejected", true],
  [NARUTO, "Naruto Omnibus Vol 1/2/3, 4/5/6, 7/8/9, 10/11/12", "rejected", true],
  [NARUTO, "Naruto, Vol. 9: Neji vs. Hinata", "rejected", false],
  [NARUTO, "Shonen Jump Magazine September 2009 Volume 7 Issue 9", "rejected", true],
  [ONE_PIECE, "One Piece, Vol. 68", "verified", false],
  [ONE_PIECE, "One Piece Manga Box Set 1 Vol 1-23 East Blue", "rejected", true],
  [ONE_PIECE, "One Piece Manga, German, Used, Volumes 1-2", "rejected", true],
  [ONE_PIECE, "One Piece (Omnibus Edition), Vol. 13: Includes vols. 37, 38 & 39", "rejected", false],
];

const rowFor = (title, index) => ({
  itemId: String(100000000000 + index), title, url: `https://www.ebay.com/itm/${100000000000 + index}`,
  keyword: "title search", listingType: "buy_it_now", soldPrice: "10", soldCurrency: "USD",
});

let dismissed = 0;
let kept = 0;
const report = [];
CASES.forEach(([target, title, human, expected], index) => {
  const built = buildTitleSearchOutcomeRow(rowFor(title, index), target, [], "source");
  const reasons = autoDismissReasons(built.match_assessment, title, target);
  const auto = reasons.length > 0;
  report.push(`${auto ? "AUTO-DISMISS" : "keep        "}  ${human.padEnd(8)}  ${title.slice(0, 60)}${auto ? `  (${reasons.join(", ")})` : ""}`);
  // The hard rule: never dismiss something a person verified.
  if (human === "verified") assert.equal(auto, false, `would have dismissed a verified sale: ${title}`);
  if (process.env.STRICT !== "0") assert.equal(auto, expected, `${title}: expected ${expected ? "dismiss" : "keep"}, got ${auto ? "dismiss" : "keep"} (${built.match_assessment.conflicts.join("; ")})`);
  if (auto) dismissed += 1; else kept += 1;
});
console.log(report.join("\n"));
console.log(`\n${dismissed} auto-dismissed, ${kept} left for a person (was ${CASES.length}).`);

// A dismissed row is closed as "wrong edition", never as a sale, and says who
// closed it.
{
  const built = buildTitleSearchOutcomeRow(rowFor("Chibi Maruko-chan Vol.1-18 Comic Manga Set", 99), MARUKO, [], "source");
  const closed = autoDismissedOutcomeRow(built, autoDismissReasons(built.match_assessment, "Chibi Maruko-chan Vol.1-18 Comic Manga Set", MARUKO), "2026-11-14T00:00:00.000Z");
  assert.equal(closed.status, "inaccessible");
  assert.equal(closed.reviewed_by, AUTO_DISMISS_REVIEWER);
  assert.equal(closed.next_check_at, null);
  assert.match(String(closed.review_notes), /multi-volume lot or set/);
  assert.match(String(closed.review_notes), /Not reviewed by a person/);
  for (const field of ["sold_price", "sold_currency", "sold_at", "resulting_observation_id"]) {
    assert.ok(!(field in closed) || closed[field] == null, `${field} must stay empty`);
  }
}
// Things that look close but must stay with a person.
{
  const SPANISH = edition("One Piece", 1, "Spanish", "Planeta");
  for (const [target, title] of [
    [ONE_PIECE, "One Piece Vol. 13 Shonen Jump Manga VIZ Media English"],
    [NARUTO, "Naruto Vol 9 Shonen Jump Edition Paperback"],
    [NARUTO, "Naruto, Vol. 9 English Japanese Manga by Masashi Kishimoto"],
    [SPANISH, "One Piece Tomo 1 Spanish Planeta"],
    [ONE_PIECE, "One Piece Vol 13 1st Print 2007"],
  ]) {
    const built = buildTitleSearchOutcomeRow(rowFor(title, 500), target, [], "source");
    assert.deepEqual(autoDismissReasons(built.match_assessment, title, target), [], `must not dismiss: ${title}`);
  }
}
console.log("auto-dismiss tests passed");
