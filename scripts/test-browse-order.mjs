import assert from "node:assert/strict";
import {
  browseSeriesKey,
  browseSeriesName,
  browseVolumeNumber,
  compareBrowseEditions,
} from "../lib/browseOrder.ts";

const edition = (overrides = {}) => ({
  title: null,
  series: null,
  volume_number: null,
  language: "English",
  collectible_type: "manga",
  issue_year: null,
  issue_number_label: null,
  edition_statement: null,
  publisher: null,
  ...overrides,
});

const onePieceRecords = [
  edition({ title: "One Piece 1", series: "One Piece", volume_number: "1" }),
  edition({ title: "ONE PIECE 13" }),
  edition({ title: "One Piece Volume 14" }),
  edition({ title: "One Piece 1", series: "ONE PIECE", volume_number: "1" }),
];

assert.deepEqual(
  [...new Set(onePieceRecords.map(browseSeriesKey))],
  ["onepiece"],
  "One Piece casing and incomplete imports should group together",
);
assert.equal(browseSeriesName(onePieceRecords[3]), "One Piece");
assert.equal(browseVolumeNumber(onePieceRecords[1]), "13");
assert.equal(browseVolumeNumber(onePieceRecords[2]), "14");

const bleach = [10, 2, 8, 1].map((volume) => edition({
  title: `Bleach, Vol. ${volume}`,
  series: "Bleach",
  volume_number: String(volume),
}));
assert.deepEqual(
  bleach.sort(compareBrowseEditions).map(browseVolumeNumber),
  ["1", "2", "8", "10"],
  "Manga must sort by numeric volume, not import date or text",
);

const mixed = [
  edition({ title: "One Piece Omnibus 1", series: "One Piece", volume_number: "1", edition_statement: "3-in-1 omnibus" }),
  edition({ title: "One Piece 2", series: "One Piece", volume_number: "2" }),
  edition({ title: "One Piece 1", series: "One Piece", volume_number: "1" }),
];
assert.deepEqual(
  mixed.sort(compareBrowseEditions).map((record) => record.title),
  ["One Piece 1", "One Piece Omnibus 1", "One Piece 2"],
  "Standard volumes should precede omnibus records for the same volume",
);

const magazines = [
  edition({ title: "Weekly Shonen Jump", collectible_type: "zasshi", issue_year: 1984, issue_number_label: "51" }),
  edition({ title: "Weekly Shonen Jump", collectible_type: "zasshi", issue_year: 1985, issue_number_label: "1" }),
  edition({ title: "Weekly Shonen Jump", collectible_type: "zasshi", issue_year: 1984, issue_number_label: "52" }),
];
assert.deepEqual(
  magazines.sort(compareBrowseEditions).map((record) => `${record.issue_year}-${record.issue_number_label}`),
  ["1985-1", "1984-52", "1984-51"],
  "Magazine issues should remain in reverse chronological order",
);

console.log("Browse grouping and ordering tests passed.");
