import assert from "node:assert/strict";
import { interpretEbayAvailabilityResponse } from "../lib/ebayScout.ts";
import { diagnoseScoutBacklog, isScoutLeadStale } from "../lib/scoutDiagnostics.ts";

const now = Date.parse("2026-08-15T12:00:00.000Z");
const edition = {
  title: "One Piece 1",
  series: "One Piece",
  volume_number: "1",
  language: "Japanese",
  isbn_13: "9784088725093",
  publisher: "Shueisha",
  format: "Tankobon",
  printing_number: 1,
  edition_statement: "First printing",
  variant_name: null,
  collectible_type: "manga",
  issue_year: null,
  issue_number_label: null,
  cumulative_issue_no: null,
};

assert.equal(isScoutLeadStale("2026-08-08T11:59:59.000Z", now), false, "eight-day boundary must not hide a current lead early");
assert.equal(isScoutLeadStale("2026-08-07T11:59:59.000Z", now), true, "records older than eight days are stale");

const diagnostics = diagnoseScoutBacklog([
  { id: "1", externalId: "same", profileId: "good", listingTitle: "One Piece manga Vol 1 Japanese Shueisha first print", itemEndAt: null, lastSeenAt: "2026-08-15T10:00:00.000Z", edition },
  { id: "2", externalId: "same", profileId: "other", listingTitle: "One Piece manga Vol 1 Japanese", itemEndAt: null, lastSeenAt: "2026-08-15T10:00:00.000Z", edition },
  { id: "3", externalId: "stale", profileId: "good", listingTitle: "One Piece manga Vol 1 Japanese", itemEndAt: null, lastSeenAt: "2026-07-30T10:00:00.000Z", edition },
  { id: "4", externalId: "expired", profileId: "good", listingTitle: "One Piece manga Vol 1 Japanese", itemEndAt: "2026-08-01T10:00:00.000Z", lastSeenAt: "2026-08-01T10:00:00.000Z", edition },
], now);

assert.equal(diagnostics.total, 4);
assert.equal(diagnostics.reviewNow, 2, "only current plausible leads belong in Review now");
assert.equal(diagnostics.stale, 1);
assert.equal(diagnostics.expiredWithEndDate, 1);
assert.equal(diagnostics.duplicateGroups, 1);
assert.equal(diagnostics.duplicateRows, 1);

assert.deepEqual(
  interpretEbayAvailabilityResponse(200, { itemEndDate: "2026-08-16T12:00:00.000Z", estimatedAvailabilities: [{ estimatedAvailabilityStatus: "IN_STOCK" }] }, now),
  { outcome: "active", itemEndAt: "2026-08-16T12:00:00.000Z", reason: "eBay confirms that the listing remains available." },
);
assert.equal(interpretEbayAvailabilityResponse(200, { itemEndDate: "2026-08-14T12:00:00.000Z" }, now).outcome, "unavailable");
assert.equal(interpretEbayAvailabilityResponse(200, { estimatedAvailabilities: [{ estimatedAvailabilityStatus: "OUT_OF_STOCK" }] }, now).outcome, "unavailable");
assert.equal(interpretEbayAvailabilityResponse(404, { errors: [{ message: "Item not found" }] }, now).outcome, "unavailable");
assert.equal(interpretEbayAvailabilityResponse(429, { errors: [{ message: "Rate limit" }] }, now).outcome, "inconclusive");
assert.equal(interpretEbayAvailabilityResponse(500, null, now).outcome, "inconclusive");

console.log("Scout phase 3 diagnostics and availability checks: 13 assertions passed.");
