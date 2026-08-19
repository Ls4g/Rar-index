import assert from "node:assert/strict";
import { candidateMatchesDiscoveryTarget, planCatalogueDiscoveryTargets, volumeFromCatalogueTitle } from "../lib/catalogueCurator.ts";

assert.equal(volumeFromCatalogueTitle("ONE PIECE 2"), 2);
assert.equal(volumeFromCatalogueTitle("呪術廻戦 3巻"), 3);
assert.equal(volumeFromCatalogueTitle("Hunter x Hunter, Vol. 4"), 4);

const japaneseRequest = {
  id: "request-1",
  requested_title: "Jujutsu Kaisen Vol. 2",
  series: "Jujutsu Kaisen",
  volume_number: "2",
  language: "Japanese",
  publisher: "Shueisha",
  isbn_13: "9784088816661",
  collectible_type: "tankobon",
  status: "pending",
};

const requestTargets = planCatalogueDiscoveryTargets([japaneseRequest], [], [], 1);
assert.equal(requestTargets.length, 1);
assert.equal(requestTargets[0].source, "shueisha_direct");
assert.equal(requestTargets[0].query, "9784088816661");

const japaneseRequestWithoutIsbn = { ...japaneseRequest, id: "request-2", isbn_13: null };
assert.equal(planCatalogueDiscoveryTargets([japaneseRequestWithoutIsbn], [], [], 1).length, 0);

const alreadyQueued = [{
  candidate_title: "呪術廻戦 2",
  candidate_series: "Jujutsu Kaisen",
  candidate_volume_number: "2",
  candidate_language: "Japanese",
  candidate_isbn_13: "9784088816661",
  raw_payload: { agent_discovery: { request_id: "request-1" } },
}];
assert.equal(planCatalogueDiscoveryTargets([japaneseRequest], [], alreadyQueued, 1).length, 0);

const editions = [
  { title: "One Piece, Vol. 1", series: "One Piece", volume_number: "1", language: "English", publisher: "VIZ Media", isbn_13: "9781569319017", collectible_type: "tankobon" },
  { title: "ONE PIECE 1", series: "One Piece", volume_number: "1", language: "Japanese", publisher: "Shueisha", isbn_13: "9784088725093", collectible_type: "tankobon" },
];
const gapTargets = planCatalogueDiscoveryTargets([], editions, [], 2);
assert.deepEqual(gapTargets.map((target) => [target.source, target.query]), [
  ["open_library", "One Piece 2"],
]);

const target = gapTargets[0];
const correctCandidate = {
  external_id: "OL-test",
  source_record_url: "https://openlibrary.org/books/OL-test",
  raw_payload: {},
  candidate_kind: "edition_candidate",
  candidate_title: "One Piece, Vol. 2",
  candidate_author: "Eiichiro Oda",
  candidate_publisher: "VIZ Media",
  candidate_language: "English",
  candidate_isbn_13: "9781591160571",
  candidate_release_date: "2003-11-01",
};
assert.equal(candidateMatchesDiscoveryTarget(correctCandidate, target), true);
assert.equal(candidateMatchesDiscoveryTarget({ ...correctCandidate, candidate_title: "One Piece, Vol. 8" }, target), false);
assert.equal(candidateMatchesDiscoveryTarget({ ...correctCandidate, candidate_language: "Japanese" }, target), false);

const isbnTarget = { ...target, isbn13: "9781591160571", volumeNumber: null };
assert.equal(candidateMatchesDiscoveryTarget({ ...correctCandidate, candidate_title: "Unexpected catalogue title" }, isbnTarget), true);
assert.equal(candidateMatchesDiscoveryTarget({ ...correctCandidate, candidate_isbn_13: "9780000000002" }, isbnTarget), false);

console.log("Catalogue Curator discovery tests passed.");
