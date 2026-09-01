// Regression checks for bugs found during the August staff workflow audit.
// Run with: node --experimental-strip-types scripts/test-workflow-regressions.mjs
import { assessEditionMatch, splitIssueNumbers } from "../lib/editionMatch.ts";
import { dedupeLiveListings, listingIsMultiVolumeLot } from "../lib/liveListings.ts";
import { describeSaleFrequency } from "../lib/saleFrequency.ts";
import { queuedReviewMetadata, catalogueMetadataProblem } from "../lib/catalogueReviewMetadata.ts";
import { scoutListingGroupKey } from "../lib/scoutGrouping.ts";

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`PASS  ${label}`);
  else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const listing = (title) => ({ title, series: null, volume_number: null, language: null, isbn_13: null, publisher: null, format: null });

const firstPrint = {
  title: "Kagurabachi, Vol. 1",
  series: "Kagurabachi",
  volume_number: "1",
  language: "English",
  isbn_13: "9781974747500",
  publisher: "VIZ Media",
  format: "Paperback",
  printing_number: 1,
};
const laterPrint = assessEditionMatch(firstPrint, listing("Kagurabachi Vol. 1 Manga First Edition 5th Print"));
check("later printing conflicts with a first-print target", laterPrint.confidence === "conflict" && laterPrint.conflicts.some((value) => value.includes("printing 5")), JSON.stringify(laterPrint));

const actualFirst = assessEditionMatch(firstPrint, listing("Kagurabachi Vol. 1 Manga 1st Printing"));
check("matching first-print wording does not conflict", actualFirst.confidence !== "conflict" && actualFirst.reasons.includes("printing 1 matches"), JSON.stringify(actualFirst));

check("hash-prefixed volume ranges are lots", listingIsMultiVolumeLot("Initial D #1-3 English Manga", 1));
const deduped = dedupeLiveListings([
  { external_id: "123", source_listing_url: "https://www.ebay.com/itm/123?foo=1" },
  { external_id: "123", source_listing_url: "https://www.ebay.co.uk/itm/123?bar=2" },
  { external_id: "456", source_listing_url: "https://www.ebay.com/itm/456" },
]);
check("live listings found through multiple profiles display once", deduped.length === 2);
check("monthly sale-frequency grammar is singular", !describeSaleFrequency(["2026-01-01", "2026-02-01", "2026-03-01"])?.label.includes("1 months"));

const dragonBall = { ...firstPrint, title: "Dragon Ball, Vol. 1", series: "Dragon Ball", printing_number: null };
for (const variant of ["Dragon Ball Z Vol. 1 Manga", "Dragon Ball Super Vol. 1 Manga"]) {
  const result = assessEditionMatch(dragonBall, listing(variant));
  check(`${variant} conflicts with Dragon Ball`, result.confidence === "conflict" && result.conflicts.some((value) => value.includes("different series")), JSON.stringify(result));
}
const originalDragonBall = assessEditionMatch(dragonBall, listing("Dragon Ball Vol. 1 Manga"));
check("the original Dragon Ball series still matches", originalDragonBall.confidence !== "conflict", JSON.stringify(originalDragonBall));

const sameA = scoutListingGroupKey("ebay", "123", "edition-a", "profile-a");
const sameB = scoutListingGroupKey("ebay", "123", "edition-a", "profile-b");
const different = scoutListingGroupKey("ebay", "123", "edition-b", "profile-c");
check("duplicate profiles for one edition group together", sameA === sameB);
check("one listing cannot group decisions across editions", sameA !== different);

const zasshiPayload = { review_metadata: {
  collectible_type: "zasshi",
  magazine_title_id: "a-magazine-id",
  issue_year: "1998",
  issue_number_label: "4・5",
  cumulative_issue_no: "1471",
  madb_id: "M123",
} };
const zasshiMetadata = queuedReviewMetadata(zasshiPayload);
check("queued magazine identity survives approval metadata cleaning", zasshiMetadata.collectible_type === "zasshi" && zasshiMetadata.issue_number_label === "4・5" && catalogueMetadataProblem(zasshiMetadata) === null);
check("incomplete magazine identity is blocked", catalogueMetadataProblem({ ...zasshiMetadata, magazine_title_id: null }) !== null);
check("magazine fields cannot silently default to a book", catalogueMetadataProblem({ ...zasshiMetadata, collectible_type: null }) !== null);
check("combined issue labels preserve both issue numbers", JSON.stringify(splitIssueNumbers("4・5")) === JSON.stringify([4, 5]));

console.log(`\n${failures ? `${failures} workflow regression check(s) failed` : "All workflow regression checks passed"}.`);
process.exit(failures ? 1 : 0);
