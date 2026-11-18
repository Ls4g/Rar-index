import assert from "node:assert/strict";
import { hasOneCoverPerEdition, isMatchingPublisherCover, orderCoverChoices, strongestCoverPerEdition } from "../lib/coverCandidateChoice.ts";

const candidate = (id, editionId, sourceName, matchConfidence = "strong", matchScore = 90) =>
  ({ id, editionId, sourceName, matchConfidence, matchScore });
const google = candidate("google", "viz-1", "Google Books", "strong", 100);
const viz = candidate("viz", "viz-1", "VIZ Media", "strong", 85);
const wrongPublisher = candidate("wrong", "other-1", "VIZ Media", "strong", 90);
assert.equal(isMatchingPublisherCover("VIZ Media", "VIZ Media"), true);
assert.equal(isMatchingPublisherCover("VIZ Media", "Kodansha USA"), false);
assert.deepEqual(orderCoverChoices([google, viz], "VIZ Media").map((row) => row.id), ["viz", "google"],
  "a matching publisher cover leads the comparison despite a higher aggregator score");
assert.deepEqual(orderCoverChoices([viz, google], "Kodansha USA").map((row) => row.id), ["google", "viz"],
  "a different publisher cannot receive the official-source preference");
assert.deepEqual(strongestCoverPerEdition([google, viz, wrongPublisher],
  new Map([["viz-1", "VIZ Media"], ["other-1", "Kodansha USA"]])).map((row) => row.id),
  ["viz", "wrong"], "the bulk shortcut chooses at most one strong candidate for each edition");
// Owner's request (18 Nov 2026): the shortcut prefers the edition's own
// publisher cover, which is usually "partial" because publisher pages omit
// the ISBN.
const vizPartial = candidate("viz-partial", "one", "VIZ Media", "partial", 60);
const googleStrong = candidate("google-strong", "one", "Google Books", "strong", 100);
assert.deepEqual(strongestCoverPerEdition([googleStrong, vizPartial], new Map([["one", "VIZ Media"]])).map((row) => row.id),
  ["viz-partial"], "the edition's own publisher cover is preselected over a strong aggregator match");
assert.deepEqual(orderCoverChoices([googleStrong, vizPartial], "VIZ Media").map((row) => row.id), ["viz-partial", "google-strong"]);
assert.deepEqual(strongestCoverPerEdition([candidate("viz-other", "two", "VIZ Media", "partial")], new Map([["two", "Kodansha USA"]])), [],
  "another publisher's partial cover is never preselected");
assert.deepEqual(strongestCoverPerEdition([candidate("ol-partial", "three", "Open Library", "partial")], new Map([["three", "VIZ Media"]])), [],
  "a partial match from a non-publisher source is never preselected");
assert.equal(hasOneCoverPerEdition([{ edition_id: "viz-1" }, { edition_id: "viz-2" }]), true);
assert.equal(hasOneCoverPerEdition([{ edition_id: "viz-1" }, { edition_id: "viz-1" }]), false,
  "the server must reject multiple verified choices for one edition");
console.log("Cover candidate ordering and one-per-edition selection passed.");
