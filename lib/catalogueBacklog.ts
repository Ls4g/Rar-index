// The Catalogue Curator's backlog and its scheduler.
//
// The old planner read nine hard-coded names from lib/prioritySeries.ts, sorted
// them by that list's own index, and took the first four. One Piece is index 0,
// so One Piece won every run and the review queue filled with One Piece
// volumes. Nothing outside that file could ever be discovered.
//
// This replaces the ordering with rotation. Everything here is a pure function
// over rows so the fairness rules can be tested without a database or a
// network, which is the only way to be sure One Piece cannot monopolise a run.

export const LANES = ["established", "rising", "new_release", "series_gap"] as const;
export type DiscoveryLane = (typeof LANES)[number];

export type TargetStatus = "watching" | "researchable" | "staged" | "published" | "blocked" | "caught_up";

export type BacklogTarget = {
  id: string;
  discovery_source: string;
  external_id: string;
  title_english: string | null;
  title_romaji: string | null;
  title_native: string | null;
  series_key: string;
  lane: DiscoveryLane;
  language: "English" | "Japanese" | null;
  score: number | null;
  series_status: string | null;
  reported_volume_count: number | null;
  next_missing_volume: number | null;
  status: TargetStatus;
  source_url: string | null;
  source_metadata?: Record<string, unknown> | null;
  last_checked_at: string | null;
  next_check_at: string | null;
  failure_count: number;
  last_result: string | null;
};

// Roughly ten searches a run, no more than two volumes from any one series,
// and at least five distinct series whenever the backlog can supply them.
export const TARGETS_PER_RUN = 10;
export const MAX_PER_SERIES_PER_RUN = 2;
export const MIN_DISTINCT_SERIES = 5;

// A collector asking for something outranks anything RAR chose for itself.
// Beyond that the lanes take turns, so a quiet lane is never starved by a
// loud one.
const LANE_ROTATION: DiscoveryLane[] = ["series_gap", "established", "rising", "new_release"];

export function normaliseSeriesKey(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFKD")
    .replaceAll("×", "x")
    .toLocaleLowerCase()
    .replace(/\bvol(?:ume)?\.?\s*\d+\b/g, "")
    .replace(/[^a-z0-9぀-ヿ一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isDue(target: Pick<BacklogTarget, "status" | "next_check_at">, now = Date.now()) {
  // watching means "no physical volume exists yet" -- rechecked, but it is not
  // a search RAR expects to succeed.
  if (target.status !== "researchable" && target.status !== "watching") return false;
  if (!target.next_check_at) return true;
  return new Date(target.next_check_at).getTime() <= now;
}

// Repeated empty searches are the normal case, not an error: an unreleased
// volume simply does not exist yet. Backing off is what stops the scheduler
// spending every run rediscovering that.
const BACKOFF_DAYS = [1, 3, 7, 21, 60];
export const MAX_FAILURES_BEFORE_BLOCK = BACKOFF_DAYS.length;

export function nextCheckAfterFailure(failureCount: number, from = new Date()) {
  const days = BACKOFF_DAYS[Math.min(failureCount, BACKOFF_DAYS.length - 1)];
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

export function nextCheckAfterSuccess(from = new Date()) {
  return new Date(from.getTime() + 14 * 86_400_000).toISOString();
}

function targetScore(target: BacklogTarget) {
  return target.score ?? 0;
}

/**
 * Choose this run's targets.
 *
 * Rotates lane by lane, taking the best available target from each in turn, so
 * no lane and no series can take the run. The per-series cap is applied while
 * selecting rather than afterwards, because filtering a One-Piece-heavy list
 * down at the end just produces a short run instead of a fair one.
 */
export function planRun(
  backlog: BacklogTarget[],
  options: { limit?: number; maxPerSeries?: number; now?: number } = {},
): BacklogTarget[] {
  const limit = options.limit ?? TARGETS_PER_RUN;
  const maxPerSeries = options.maxPerSeries ?? MAX_PER_SERIES_PER_RUN;
  const now = options.now ?? Date.now();

  const due = backlog.filter((target) => isDue(target, now));
  const byLane = new Map<DiscoveryLane, BacklogTarget[]>();
  for (const lane of LANES) byLane.set(lane, []);
  for (const target of due) byLane.get(target.lane)?.push(target);

  for (const lane of LANES) {
    byLane.get(lane)!.sort((left, right) => {
      // Never looked at yet beats already looked at, so a newly discovered
      // title is not stuck behind a long-standing one forever.
      const leftSeen = left.last_checked_at ? 1 : 0;
      const rightSeen = right.last_checked_at ? 1 : 0;
      if (leftSeen !== rightSeen) return leftSeen - rightSeen;
      // Fewer past failures first: a target that keeps coming back empty
      // should not crowd out one that has never been tried.
      if (left.failure_count !== right.failure_count) return left.failure_count - right.failure_count;
      // An early volume matters more than a late one -- volume 2 of a series
      // RAR half-holds is worth more than volume 40.
      const leftVolume = left.next_missing_volume ?? 0;
      const rightVolume = right.next_missing_volume ?? 0;
      if (leftVolume !== rightVolume) return leftVolume - rightVolume;
      return targetScore(right) - targetScore(left);
    });
  }

  const chosen: BacklogTarget[] = [];
  const perSeries = new Map<string, number>();
  let laneIndex = 0;
  let exhaustedLanes = 0;

  while (chosen.length < limit && exhaustedLanes < LANES.length) {
    const lane = LANE_ROTATION[laneIndex % LANE_ROTATION.length];
    laneIndex += 1;
    const queue = byLane.get(lane)!;

    // Take the best target in this lane whose series still has room.
    const index = queue.findIndex((target) => (perSeries.get(target.series_key) ?? 0) < maxPerSeries);
    if (index === -1) { exhaustedLanes += 1; continue; }
    exhaustedLanes = 0;
    const [target] = queue.splice(index, 1);
    chosen.push(target);
    perSeries.set(target.series_key, (perSeries.get(target.series_key) ?? 0) + 1);
  }

  return chosen;
}

// Reported for the staff UI and the agent metrics, so a run that quietly went
// back to being One-Piece-shaped is visible rather than assumed away.
export function describeRunFairness(chosen: BacklogTarget[]) {
  const series = new Map<string, number>();
  const lanes = new Map<string, number>();
  for (const target of chosen) {
    series.set(target.series_key, (series.get(target.series_key) ?? 0) + 1);
    lanes.set(target.lane, (lanes.get(target.lane) ?? 0) + 1);
  }
  const largest = [...series.values()].reduce((max, value) => Math.max(max, value), 0);
  return {
    targets: chosen.length,
    distinctSeries: series.size,
    distinctLanes: lanes.size,
    largestSeriesShare: largest,
    meetsDistinctSeriesGoal: series.size >= Math.min(MIN_DISTINCT_SERIES, chosen.length),
    perLane: Object.fromEntries(lanes),
  };
}

/**
 * The next volume worth researching for a series RAR already holds.
 *
 * Deliberately conservative. It returns the first gap in what RAR holds, or
 * the volume after the highest held one -- but only ever as something to LOOK
 * FOR. Existence is never inferred from the previous volume existing: the
 * search either finds an exact bibliographic record or the target backs off.
 *
 * Where the source reports a real volume count -- which AniList only does for
 * finished series -- a series held to the end is marked caught_up instead of
 * being asked about volume 25 of 24 for ever.
 */
export function nextVolumeToResearch(
  heldVolumes: number[],
  reportedVolumeCount: number | null,
): { volume: number | null; caughtUp: boolean } {
  const held = new Set(heldVolumes.filter((value) => Number.isInteger(value) && value > 0));
  if (!held.size) return { volume: 1, caughtUp: false };

  const highest = Math.max(...held);
  for (let volume = 1; volume < highest; volume += 1) {
    if (!held.has(volume)) return { volume, caughtUp: false };
  }
  if (reportedVolumeCount !== null && highest >= reportedVolumeCount) {
    return { volume: null, caughtUp: true };
  }
  return { volume: highest + 1, caughtUp: false };
}
