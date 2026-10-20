import assert from "node:assert/strict";
import { isScoutView, matchesScoutView } from "../lib/scoutInboxView.ts";

const now = Date.parse("2026-10-20T12:00:00Z");
const lead = {
  reviewStatus: "new", isExpired: false, isStale: false,
  isSurplusBackup: false, isGraded: false, score: 75,
  itemEndAt: "2026-10-21T12:00:00Z",
};

assert.equal(isScoutView("reviewNow"), true);
assert.equal(isScoutView("archive"), false);
assert.equal(matchesScoutView(lead, "reviewNow", now), true);
assert.equal(matchesScoutView(lead, "highConfidence", now), true);
assert.equal(matchesScoutView(lead, "endsSoon", now), true);
assert.equal(matchesScoutView({ ...lead, isGraded: true }, "reviewNow", now), false);
assert.equal(matchesScoutView({ ...lead, isGraded: true }, "graded", now), true);
assert.equal(matchesScoutView({ ...lead, isSurplusBackup: true }, "surplusBackups", now), true);
assert.equal(matchesScoutView({ ...lead, isStale: true }, "staleBacklog", now), true);
assert.equal(matchesScoutView({ ...lead, reviewStatus: "watching" }, "watching", now), true);
assert.equal(matchesScoutView({ ...lead, reviewStatus: "dismissed" }, "dismissed", now), true);
assert.equal(matchesScoutView({ ...lead, score: 30 }, "lowConfidenceBacklog", now), true);
assert.equal(matchesScoutView({ ...lead, itemEndAt: "2026-10-25T12:00:00Z" }, "endsSoon", now), false);

console.log("Scout inbox view selection passed.");
