import assert from "node:assert/strict";
import "./test-publication-navigation.mjs";
import { comparableRawSalesByPublication, ebayCompletedSearchUrl, leadingRawSaleGroupsByPublication, oneSearchPerPublication, prioritiseSoldSearches, publicationIdByEdition, soldSearchReason } from "../lib/soldSearchPriority.ts";

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
assert.deepEqual(ordered.map((row) => row.profileId), ["four", "two", "three", "one", "zero", "magazine-zero"]);
assert.equal(ordered.some((row) => row.profileId === "covered"), false);
assert.equal(soldSearchReason(0, "tankobon"), "Needs three verified raw sales to unlock a chart");
assert.equal(soldSearchReason(0, "zasshi"), "No verified raw sale yet");
assert.equal(soldSearchReason(2), "One verified raw sale could unlock its chart");
assert.match(ebayCompletedSearchUrl("Hunter x Hunter manga vol 1"), /LH_Sold=1&LH_Complete=1/);
assert.match(ebayCompletedSearchUrl("Hunter x Hunter manga vol 1"), /Hunter%20x%20Hunter/);

const publications = [
  { id: "one-piece-jp", printing_of_edition_id: null },
  { id: "one-piece-jp-first", printing_of_edition_id: "one-piece-jp" },
  { id: "one-piece-english", printing_of_edition_id: null },
];
const raw = (edition_id, print_classification, known_printing_number = null, grading_company = null) => ({ edition_id, print_classification, known_printing_number, grading_company, grade_label: null });
const grouped = comparableRawSalesByPublication(publications, [
  raw("one-piece-jp", "first_print_proven"),
  raw("one-piece-jp-first", "first_print_proven"),
  raw("one-piece-jp-first", "first_print_proven"),
  raw("one-piece-jp-first", "first_print_proven"),
  raw("one-piece-jp-first", "printing_not_identified"),
  raw("one-piece-jp", "first_print_proven", null, "BGS"),
  raw("one-piece-english", "first_print_proven"),
]);
assert.equal(grouped.get("one-piece-jp"), 4, "parent and child first-print sales make one comparable group");
assert.deepEqual(leadingRawSaleGroupsByPublication(publications, [raw("one-piece-jp", "first_print_proven"), raw("one-piece-jp-first", "first_print_proven")]).get("one-piece-jp"), { classification: "first_print_proven", count: 2 });
assert.deepEqual(leadingRawSaleGroupsByPublication(publications, [
  ...Array.from({ length: 5 }, () => raw("one-piece-jp-first", "first_print_proven")),
  raw("one-piece-jp", "printing_not_identified"),
  raw("one-piece-jp-first", "printing_not_identified"),
]).get("one-piece-jp"), { classification: "printing_not_identified", count: 2 }, "a complete print group cannot hide another group near its chart");
assert.equal(grouped.get("one-piece-english"), 1, "different publications do not share sales");
assert.equal(publicationIdByEdition(publications).get("one-piece-jp-first"), "one-piece-jp");
assert.deepEqual(oneSearchPerPublication([
  { id: "narrow", edition_id: "one-piece-jp-first" },
  { id: "broad", edition_id: "one-piece-jp" },
  { id: "english", edition_id: "one-piece-english" },
], publications).map((profile) => profile.id), ["broad", "english"], "one search per publication, preferring the general profile");
assert.equal(oneSearchPerPublication([
  { id: "narrow", edition_id: "one-piece-jp-first", search_query: "One Piece 1 first print" },
  { id: "broad", edition_id: "one-piece-jp", search_query: "One Piece 1" },
], publications, leadingRawSaleGroupsByPublication(publications, [raw("one-piece-jp", "first_print_proven")]))[0].id, "narrow", "a first-print group keeps its targeted search");
console.log("sold search priority checks passed");
