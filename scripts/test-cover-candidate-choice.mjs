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
assert.deepEqual(strongestCoverPerEdition([candidate("partial", "one", "VIZ Media", "partial")],
  new Map([["one", "VIZ Media"]])), [], "partial matches are never bulk-preselected");
assert.equal(hasOneCoverPerEdition([{ edition_id: "viz-1" }, { edition_id: "viz-2" }]), true);
assert.equal(hasOneCoverPerEdition([{ edition_id: "viz-1" }, { edition_id: "viz-1" }]), false,
  "the server must reject multiple verified choices for one edition");
console.log("Cover candidate ordering and one-per-edition selection passed.");
