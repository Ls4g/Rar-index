import assert from "node:assert/strict";
import { ebayCompletedSearchUrl, prioritiseSoldSearches, soldSearchReason } from "../lib/soldSearchPriority.ts";

const candidate = (profileId, comparableRawSales, series = "Other", collectibleType = "tankobon") => ({
  profileId,
  editionId: `edition-${profileId}`,
  query: `${series} manga vol 1`,
  title: series,
  series,
  volumeNumber: 1,
  language: "English",
  collectibleType,
  comparableRawSales,
});

const ordered = prioritiseSoldSearches([
  candidate("zero", 0), candidate("four", 4), candidate("covered", 5),
  candidate("three", 3), candidate("one", 1), candidate("two", 2),
  candidate("magazine-zero", 0, "Weekly Shonen Jump", "zasshi"),
], 10);
assert.deepEqual(ordered.map((row) => row.profileId), ["zero", "two", "four", "one", "three", "magazine-zero"]);
assert.equal(ordered.some((row) => row.profileId === "covered"), false);
assert.equal(soldSearchReason(0, "tankobon"), "Top priority: manga with no verified raw sale");
assert.equal(soldSearchReason(0, "zasshi"), "No verified raw sale yet");
assert.equal(soldSearchReason(2), "One verified raw sale could unlock its chart");
assert.match(ebayCompletedSearchUrl("Hunter x Hunter manga vol 1"), /LH_Sold=1&LH_Complete=1/);
assert.match(ebayCompletedSearchUrl("Hunter x Hunter manga vol 1"), /Hunter%20x%20Hunter/);
console.log("sold search priority: 7 checks passed");
