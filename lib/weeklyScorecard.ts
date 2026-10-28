import { APIFY_SOLD_SEARCH_PROVIDER } from "./salesInbox.ts";

export type ScorecardRun = {
  started_at: string;
  status: string;
  summary: Record<string, unknown> | null;
};
export type ScorecardReview = {
  reviewed_at: string | null;
  reviewed_by: string | null;
  resulting_observation_id: string | null;
  discovery_provider: string | null;
};
export type ScorecardEvent = { created_at: string; event_type: string };

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
const dayOf = (value: string) => value.slice(0, 10);

export function scorecardStart(now: Date) {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 6);
  return start;
}

export function buildWeeklyScorecard(runs: ScorecardRun[], reviews: ScorecardReview[], events: ScorecardEvent[], now = new Date()) {
  const start = scorecardStart(now);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return { day: dayOf(date.toISOString()), loggedRuns: 0, searches: 0, findings: 0, queued: 0, reviewed: 0,
      confirmedSales: 0, catalogueSearches: 0, editionViews: 0, shelfAdds: 0, listingClicks: 0 };
  });
  const byDay = new Map(days.map((day) => [day.day, day]));
  let failedRuns = 0;
  let spentUsd = 0;
  for (const run of runs) {
    const day = byDay.get(dayOf(run.started_at));
    if (!day) continue;
    day.loggedRuns += 1;
    if (run.status === "failed" || run.status === "partial") failedRuns += 1;
    day.searches += count(run.summary?.searched);
    day.findings += count(run.summary?.found);
    day.queued += count(run.summary?.queued);
    spentUsd += count(run.summary?.spentUsd);
  }
  for (const review of reviews) {
    if (!review.reviewed_at || !review.reviewed_by || review.discovery_provider !== APIFY_SOLD_SEARCH_PROVIDER) continue;
    const day = byDay.get(dayOf(review.reviewed_at));
    if (!day) continue;
    day.reviewed += 1;
    if (review.resulting_observation_id) day.confirmedSales += 1;
  }
  for (const event of events) {
    const day = byDay.get(dayOf(event.created_at));
    if (!day) continue;
    if (event.event_type === "catalogue_search") day.catalogueSearches += 1;
    if (event.event_type === "edition_view") day.editionViews += 1;
    if (event.event_type === "shelf_add") day.shelfAdds += 1;
    if (event.event_type === "listing_click") day.listingClicks += 1;
  }
  const total = days.reduce((sum, day) => ({
    searches: sum.searches + day.searches, findings: sum.findings + day.findings,
    queued: sum.queued + day.queued, reviewed: sum.reviewed + day.reviewed,
    confirmedSales: sum.confirmedSales + day.confirmedSales,
    catalogueSearches: sum.catalogueSearches + day.catalogueSearches,
    editionViews: sum.editionViews + day.editionViews, shelfAdds: sum.shelfAdds + day.shelfAdds,
    listingClicks: sum.listingClicks + day.listingClicks,
  }), { searches: 0, findings: 0, queued: 0, reviewed: 0, confirmedSales: 0,
    catalogueSearches: 0, editionViews: 0, shelfAdds: 0, listingClicks: 0 });
  return { days, total, failedRuns, spentUsd, loggedRuns: runs.length };
}
