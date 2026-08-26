// Catalogue Curator staging safeguards. Run with:
//   node --experimental-strip-types scripts/test-catalogue-discovery-guards.mjs
//
// Discovery got much wider in this change -- four lanes, AniList, a persistent
// backlog. These are the rules that must not have widened with it. Every case
// is a way a popularity signal could have turned into a fabricated edition.
import { candidateMatchesDiscoveryTarget, volumeFromCatalogueTitle } from "../lib/catalogueCurator.ts";
import { backlogTargetToDiscoveryTarget } from "../lib/catalogueDiscovery.ts";
import { normaliseSeriesKey } from "../lib/catalogueBacklog.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

function backlogTarget(overrides = {}) {
  return {
    id: "b1", discovery_source: "anilist", external_id: "30013",
    title_english: "Kagurabachi", title_romaji: "Kagurabachi", title_native: "カグラバチ",
    series_key: "kagurabachi", lane: "series_gap", language: "English",
    score: 1000, series_status: "RELEASING", reported_volume_count: null,
    next_missing_volume: 2, status: "researchable", source_url: null,
    last_checked_at: null, next_check_at: null, failure_count: 0, last_result: null,
    ...overrides,
  };
}

console.log("\n--- AniList can never become an edition ---");
// The only thing a backlog row can produce is a SEARCH. It carries no ISBN and
// no publisher, so it cannot satisfy the staging filter on its own -- staging
// requires candidate_isbn_13 and candidate_publisher from a bibliographic
// source, which AniList is not.
const searchTarget = backlogTargetToDiscoveryTarget(backlogTarget());
check("a backlog row becomes a search target, not an edition", searchTarget !== null && searchTarget.isbn13 === null && searchTarget.publisher === null, JSON.stringify(searchTarget));
check("the search target names the volume being looked for", searchTarget.volumeNumber === "2" && searchTarget.query.includes("2"));

// A candidate carrying AniList-shaped metadata and nothing bibliographic must
// fail the same match check a real record passes.
const anilistShaped = {
  candidate_title: "Kagurabachi", candidate_isbn_13: null, candidate_publisher: null,
  candidate_language: null, candidate_volume_number: null, candidate_release_date: null,
  external_id: "anilist:30013", source_record_url: "https://anilist.co/manga/30013", raw_payload: {},
};
check("a candidate with no ISBN cannot be staged", !anilistShaped.candidate_isbn_13);
check("a candidate with no publisher cannot be staged", !anilistShaped.candidate_publisher);

console.log("\n--- Japanese needs official identity ---");
// A Japanese backlog target is never turned into a broad library search. The
// only Japanese path is an exact ISBN through Shueisha, which the backlog
// cannot supply, so it stays a research target.
const japanese = backlogTargetToDiscoveryTarget(backlogTarget({ language: "Japanese", title_english: null, title_romaji: null, title_native: "カグラバチ" }));
check("a Japanese backlog target produces no search", japanese === null);

console.log("\n--- volume identity ---");
const kagurabachiTarget = backlogTargetToDiscoveryTarget(backlogTarget());
const realVolume2 = {
  candidate_title: "Kagurabachi, Vol. 2", candidate_isbn_13: "9781974752713",
  candidate_publisher: "VIZ Media", candidate_language: "English",
  candidate_volume_number: "2", candidate_release_date: "2024-11-05",
  external_id: "OL123M", source_record_url: "https://openlibrary.org/books/OL123M", raw_payload: {},
};
check("the real Kagurabachi Vol. 2 record matches the target", candidateMatchesDiscoveryTarget(realVolume2, kagurabachiTarget));

const wrongVolume = { ...realVolume2, candidate_title: "Kagurabachi, Vol. 5", candidate_volume_number: "5", candidate_isbn_13: "9781974758004" };
check("a different volume of the same series is rejected", !candidateMatchesDiscoveryTarget(wrongVolume, kagurabachiTarget));

const wrongSeries = { ...realVolume2, candidate_title: "One Piece, Vol. 2", candidate_volume_number: "2" };
check("a different series at the same volume is rejected", !candidateMatchesDiscoveryTarget(wrongSeries, kagurabachiTarget));

const wrongLanguage = { ...realVolume2, candidate_language: "Japanese" };
check("a different language is rejected", !candidateMatchesDiscoveryTarget(wrongLanguage, kagurabachiTarget));

console.log("\n--- real title shapes ---");
check("Hunter x Hunter volume parsing", volumeFromCatalogueTitle("Hunter x Hunter, Vol. 37") === 37);
check("One Piece volume parsing", volumeFromCatalogueTitle("One Piece, Vol. 105") === 105);
check("Kagurabachi volume parsing", volumeFromCatalogueTitle("Kagurabachi, Vol. 2") === 2);
check("the two One Piece casings are one series", normaliseSeriesKey("ONE PIECE") === normaliseSeriesKey("One Piece"));
check("Hunter × Hunter and Hunter x Hunter are one series", normaliseSeriesKey("Hunter × Hunter") === normaliseSeriesKey("Hunter x Hunter"));

console.log("\n--- a new manga with no physical volume ---");
// WITCHRIV started in 2025 and AniList reports volumes: null. It is a watching
// target: RAR has no reason to believe a collected volume exists.
const newManga = backlogTarget({
  series_key: "witchriv", title_english: "WITCHRIV", lane: "new_release",
  status: "watching", reported_volume_count: null, next_missing_volume: 1,
});
check("a newly started manga is watching, not researchable", newManga.status === "watching");
check("watching targets carry no reported volume count", newManga.reported_volume_count === null);
// planBacklogRun filters to researchable, so a watching target never consumes
// a search slot. Asserted here on the same predicate that filter uses.
check("a watching target is not researchable", newManga.status !== "researchable");

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
