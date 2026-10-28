import assert from "node:assert/strict";
import { buildWeeklyScorecard, scorecardStart } from "../lib/weeklyScorecard.ts";
import { isPublicJourneyEvent, sameOriginEvent } from "../lib/publicJourney.ts";

const now = new Date("2026-10-28T16:00:00Z");
assert.equal(scorecardStart(now).toISOString(), "2026-10-22T00:00:00.000Z");
const scorecard = buildWeeklyScorecard([
  { started_at: "2026-10-28T08:00:00Z", status: "completed", summary: { searched: 6, found: 25, queued: 21, spentUsd: 0.1 } },
  { started_at: "2026-10-21T08:00:00Z", status: "completed", summary: { searched: 6, found: 20, queued: 10 } },
], [
  { reviewed_at: "2026-10-28T10:00:00Z", reviewed_by: "staff", resulting_observation_id: "sale-id", discovery_provider: "apify_ebay_sold_search" },
  { reviewed_at: "2026-10-28T12:00:00Z", reviewed_by: "staff", resulting_observation_id: "sale-id-2", discovery_provider: "ebay_scout" },
], [
  { created_at: "2026-10-28T11:00:00Z", event_type: "catalogue_search" },
  { created_at: "2026-10-28T12:00:00Z", event_type: "edition_view" },
  { created_at: "2026-10-21T12:00:00Z", event_type: "listing_click" },
], now);
assert.equal(scorecard.total.searches, 6);
assert.equal(scorecard.total.findings, 25);
assert.equal(scorecard.total.queued, 21);
assert.equal(scorecard.total.reviewed, 1);
assert.equal(scorecard.total.confirmedSales, 1);
assert.equal(scorecard.total.catalogueSearches, 1);
assert.equal(scorecard.total.editionViews, 1);
assert.equal(scorecard.total.listingClicks, 0);
assert.equal(scorecard.spentUsd, 0.1);
assert.equal(isPublicJourneyEvent("edition_view"), true);
assert.equal(isPublicJourneyEvent("sale_verified"), false);
assert.equal(sameOriginEvent(new Request("https://rar-index.vercel.app/api/public-journey", {
  method: "POST", headers: { origin: "https://rar-index.vercel.app", "sec-fetch-site": "same-origin" },
})), true);
assert.equal(sameOriginEvent(new Request("https://rar-index.vercel.app/api/public-journey", {
  method: "POST", headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
})), false);
console.log("Weekly scorecard checks passed.");
