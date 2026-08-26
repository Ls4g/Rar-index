import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchEstablishedManga, fetchNewManga, fetchRisingManga, type AniListWork } from "./anilist.ts";
import {
  isDue, nextCheckAfterFailure, nextCheckAfterSuccess, nextVolumeToResearch,
  normaliseSeriesKey, planRun, MAX_FAILURES_BEFORE_BLOCK,
  type BacklogTarget, type DiscoveryLane,
} from "./catalogueBacklog.ts";
import type { CatalogueDiscoveryTarget } from "./catalogueCurator.ts";

export type BacklogRefreshResult = {
  established: number;
  rising: number;
  newRelease: number;
  seriesGap: number;
  caughtUp: number;
  errors: string[];
};

function pickTitle(work: AniListWork) {
  return work.titleEnglish || work.titleRomaji || work.titleNative || "";
}

// A work AniList knows about becomes a backlog row, never an edition. The
// English lane is the one RAR can actually research, because Open Library
// carries English volumes; Japanese physical editions need an exact ISBN from
// Shueisha and are held as watching until one exists.
function workToRow(work: AniListWork, lane: DiscoveryLane, score: number | null) {
  const title = pickTitle(work);
  return {
    discovery_source: "anilist",
    external_id: work.externalId,
    title_english: work.titleEnglish,
    title_romaji: work.titleRomaji,
    title_native: work.titleNative,
    series_key: normaliseSeriesKey(title),
    lane,
    language: "English" as const,
    score,
    series_status: work.status,
    reported_volume_count: work.reportedVolumes,
    next_missing_volume: null,
    source_url: work.siteUrl,
    source_metadata: {
      anilist_id: work.externalId,
      start_year: work.startYear,
      start_month: work.startMonth,
      format: work.format,
      popularity: work.popularity,
      trending: work.trending,
      note: "AniList is a work-level discovery signal. It never evidences an ISBN, publisher, printing, binding or cover.",
    },
    updated_at: new Date().toISOString(),
  };
}

async function upsertTargets(admin: SupabaseClient, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return 0;
  // ignoreDuplicates so a rediscovery never resets a target's status, failure
  // count or schedule -- what RAR has already learned about a title outranks
  // the fact that AniList still lists it.
  const { data, error } = await admin
    .from("catalogue_discovery_targets")
    .upsert(rows, { onConflict: "series_key,language,next_missing_volume", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/**
 * Refresh the backlog from AniList and from RAR's own holdings.
 *
 * A new series starts at `watching`: RAR has no reason to believe a physical
 * volume exists yet. It only becomes `researchable` once there is something
 * specific to look for.
 */
export async function refreshDiscoveryBacklog(admin: SupabaseClient): Promise<BacklogRefreshResult> {
  const result: BacklogRefreshResult = { established: 0, rising: 0, newRelease: 0, seriesGap: 0, caughtUp: 0, errors: [] };
  const thisYear = new Date().getUTCFullYear();

  try {
    const works = await fetchEstablishedManga(2, 50);
    result.established = await upsertTargets(admin, works.map((work) => ({
      ...workToRow(work, "established", work.popularity),
      // An established title is worth searching for straight away: if it is
      // popular and finished, a physical volume 1 certainly exists.
      status: "researchable",
      next_missing_volume: 1,
    })));
  } catch (error) { result.errors.push(`established: ${error instanceof Error ? error.message : "failed"}`); }

  try {
    const works = await fetchRisingManga(40);
    result.rising = await upsertTargets(admin, works.map((work) => ({
      ...workToRow(work, "rising", work.trending),
      status: "researchable",
      next_missing_volume: 1,
    })));
  } catch (error) { result.errors.push(`rising: ${error instanceof Error ? error.message : "failed"}`); }

  try {
    const works = await fetchNewManga(thisYear - 1, 40);
    result.newRelease = await upsertTargets(admin, works.map((work) => ({
      ...workToRow(work, "new_release", work.popularity),
      // Serial-only until proven otherwise. A manga that started this year
      // usually has no collected volume at all, and RAR must not publish an
      // edition for something that does not physically exist.
      status: "watching",
      next_missing_volume: 1,
    })));
  } catch (error) { result.errors.push(`new_release: ${error instanceof Error ? error.message : "failed"}`); }

  // Gaps in what RAR already holds -- every monitored series, not the nine
  // names that used to be hard-coded.
  try {
    const { data: editionData } = await admin
      .from("manga_editions")
      .select("series,volume_number,language,collectible_type,title")
      .eq("is_verified", true)
      .limit(5000);

    const held = new Map<string, { series: string; language: "English" | "Japanese"; volumes: number[] }>();
    for (const edition of (editionData ?? []) as Array<Record<string, unknown>>) {
      if ((edition.collectible_type ?? "tankobon") !== "tankobon") continue;
      const series = (edition.series as string | null) ?? null;
      const language = edition.language as string | null;
      if (!series || (language !== "English" && language !== "Japanese")) continue;
      const volume = Number.parseInt(String(edition.volume_number ?? ""), 10);
      if (!Number.isInteger(volume) || volume <= 0) continue;
      const key = `${normaliseSeriesKey(series)}:${language}`;
      const entry = held.get(key) ?? { series, language, volumes: [] };
      entry.volumes.push(volume);
      held.set(key, entry);
    }

    // What the backlog already knows about these series, so a reported volume
    // count discovered by the popularity lanes can retire a finished series.
    const { data: knownData } = await admin
      .from("catalogue_discovery_targets")
      .select("series_key,reported_volume_count,title_english,title_romaji,title_native,external_id,source_url,series_status")
      .not("reported_volume_count", "is", null);
    const reported = new Map<string, number>();
    for (const row of (knownData ?? []) as Array<Record<string, unknown>>) {
      reported.set(row.series_key as string, row.reported_volume_count as number);
    }

    const gapRows: Array<Record<string, unknown>> = [];
    for (const [, entry] of held) {
      const seriesKey = normaliseSeriesKey(entry.series);
      const { volume, caughtUp } = nextVolumeToResearch(entry.volumes, reported.get(seriesKey) ?? null);
      if (caughtUp || volume === null) { result.caughtUp += 1; continue; }
      gapRows.push({
        discovery_source: "rar_catalogue",
        external_id: `${seriesKey}:${entry.language}:${volume}`,
        title_english: entry.series,
        title_romaji: null,
        title_native: null,
        series_key: seriesKey,
        lane: "series_gap",
        language: entry.language,
        // A gap in a series RAR already holds is the most actionable thing it
        // can look for, so it outscores a popularity signal.
        score: 1000,
        series_status: null,
        reported_volume_count: reported.get(seriesKey) ?? null,
        next_missing_volume: volume,
        // Japanese needs an exact ISBN from Shueisha, and a broad library
        // search is exactly what must not be used to guess one. Held as a
        // research target rather than searched.
        status: entry.language === "Japanese" ? "watching" : "researchable",
        source_url: null,
        source_metadata: {
          held_volumes: entry.volumes.sort((left, right) => left - right),
          note: entry.language === "Japanese"
            ? "Japanese volumes are only staged from an exact Shueisha record. Held for research rather than searched broadly."
            : "Next volume to look for. Existence is not inferred from the previous volume -- the search must find an exact record.",
        },
        updated_at: new Date().toISOString(),
      });
    }
    result.seriesGap = await upsertTargets(admin, gapRows);
  } catch (error) { result.errors.push(`series_gap: ${error instanceof Error ? error.message : "failed"}`); }

  return result;
}

// Backlog rows the scheduler chose, translated into the search targets the
// existing staging path already knows how to handle. Japanese never gets a
// broad query: without an exact ISBN there is nothing safe to search.
export function backlogTargetToDiscoveryTarget(target: BacklogTarget): CatalogueDiscoveryTarget | null {
  if (target.language !== "English") return null;
  const title = target.title_english || target.title_romaji || target.title_native;
  if (!title) return null;
  const volume = target.next_missing_volume ?? 1;
  return {
    key: `backlog:${target.id}`,
    source: "open_library",
    query: `${title} ${volume}`,
    title: `${title} Vol. ${volume}`,
    series: title,
    volumeNumber: String(volume),
    language: "English",
    publisher: null,
    isbn13: null,
    requestId: null,
    reason: `lane_${target.lane}`,
  };
}

export async function readDueBacklog(admin: SupabaseClient, limit = 400): Promise<BacklogTarget[]> {
  const { data } = await admin
    .from("catalogue_discovery_targets")
    .select("id,discovery_source,external_id,title_english,title_romaji,title_native,series_key,lane,language,score,series_status,reported_volume_count,next_missing_volume,status,source_url,last_checked_at,next_check_at,failure_count,last_result")
    .in("status", ["researchable", "watching"])
    .order("score", { ascending: false, nullsFirst: false })
    .limit(limit);
  return ((data ?? []) as BacklogTarget[]).filter((target) => isDue(target));
}

export async function planBacklogRun(admin: SupabaseClient) {
  const backlog = await readDueBacklog(admin);
  // Watching targets are counted as due but must not consume search slots:
  // there is no physical volume to find yet.
  const researchable = backlog.filter((target) => target.status === "researchable");
  return { backlog, chosen: planRun(researchable) };
}

/**
 * Write back what a search actually found.
 *
 * Never invents a conclusion. A target that found nothing backs off and is
 * eventually blocked; a target that staged a candidate is marked staged and
 * waits on the human review that follows. Nothing here publishes anything.
 */
export async function recordTargetOutcome(
  admin: SupabaseClient,
  targetId: string,
  outcome: "staged" | "already_known" | "no_exact_candidate" | "failed",
  failureCount: number,
) {
  const now = new Date();
  if (outcome === "staged" || outcome === "already_known") {
    await admin.from("catalogue_discovery_targets").update({
      status: outcome === "staged" ? "staged" : "published",
      last_checked_at: now.toISOString(),
      next_check_at: nextCheckAfterSuccess(now),
      failure_count: 0,
      last_result: outcome,
      updated_at: now.toISOString(),
    }).eq("id", targetId);
    return;
  }

  const failures = failureCount + 1;
  await admin.from("catalogue_discovery_targets").update({
    // Blocked rather than deleted: a volume that does not exist yet may exist
    // next year, and the record of having looked is worth keeping.
    status: failures >= MAX_FAILURES_BEFORE_BLOCK ? "blocked" : "researchable",
    last_checked_at: now.toISOString(),
    next_check_at: nextCheckAfterFailure(failures, now),
    failure_count: failures,
    last_result: outcome,
    updated_at: now.toISOString(),
  }).eq("id", targetId);
}

export async function readBacklogSummary(admin: SupabaseClient) {
  const { data } = await admin
    .from("catalogue_discovery_targets")
    .select("lane,status,language,next_check_at")
    .limit(5000);
  const rows = (data ?? []) as Array<{ lane: string; status: string; language: string | null; next_check_at: string | null }>;
  const byLane: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  for (const row of rows) {
    byLane[row.lane] = (byLane[row.lane] ?? 0) + 1;
    byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  }
  const upcoming = rows
    .map((row) => row.next_check_at)
    .filter((value): value is string => Boolean(value))
    .sort()[0] ?? null;
  return { total: rows.length, byLane, byStatus, nextCheckAt: upcoming };
}
