import type { SupabaseClient } from "@supabase/supabase-js";
import { PRIORITY_SERIES, isPrioritySeries } from "./prioritySeries.ts";
import { searchNdlCatalogue, searchOpenLibraryCatalogue, type CatalogueSourceCandidate } from "./catalogueSources.ts";

const DISCOVERY_TARGET_LIMIT = 4;
const CANDIDATES_PER_TARGET = 1;

const JAPANESE_SEARCH_ALIASES: Record<string, string> = {
  "one piece": "ONE PIECE",
  naruto: "NARUTO",
  bleach: "BLEACH",
  "hunter x hunter": "HUNTER×HUNTER",
  "hunter hunter": "HUNTER×HUNTER",
  "jujutsu kaisen": "呪術廻戦",
  kagurabachi: "カグラバチ",
  "demon slayer kimetsu no yaiba": "鬼滅の刃",
  "demon slayer": "鬼滅の刃",
  "attack on titan": "進撃の巨人",
  "initial d": "頭文字D",
  "black clover": "ブラッククローバー",
};

export type CatalogueDiscoveryTarget = {
  key: string;
  source: "ndl_search" | "open_library";
  query: string;
  title: string;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
  requestId: string | null;
  reason: "collector_request" | "priority_series_gap";
};

export type CatalogueDiscoveryRequest = {
  id: string;
  requested_title: string;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  collectible_type: string | null;
  status: string;
};

export type CatalogueDiscoveryEdition = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  publisher: string | null;
  isbn_13: string | null;
  collectible_type: string | null;
};

export type CatalogueDiscoveryQueued = {
  source_id?: string | null;
  external_id?: string | null;
  candidate_title: string | null;
  candidate_series: string | null;
  candidate_volume_number: string | null;
  candidate_language: string | null;
  candidate_isbn_13: string | null;
  raw_payload: Record<string, unknown> | null;
};

export type CatalogueCuratorResult = {
  targetsPlanned: number;
  targetsSearched: number;
  targetsFailed: number;
  sourceRecordsFound: number;
  candidatesEligible: number;
  candidatesStaged: number;
  candidatesAlreadyQueued: number;
  candidatesAlreadyPublished: number;
  targetSummaries: Array<{ key: string; source: string; result: string }>;
};

function normalise(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[×✕]/g, "x")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function cleanIsbn(value: string | null | undefined) {
  return (value ?? "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function integerVolume(value: string | number | null | undefined) {
  const match = String(value ?? "").normalize("NFKC").match(/^\s*(?:第\s*|巻\s*)?\[?(\d{1,3})\]?(?:\s*巻)?\s*$/);
  return match ? Number(match[1]) : null;
}

export function volumeFromCatalogueTitle(value: string | null | undefined) {
  if (!value) return null;
  const explicit = value.match(/(?:vol(?:ume)?\.?\s*|第\s*)(\d{1,3})(?:\s*巻)?/i)?.[1]
    ?? value.match(/(\d{1,3})\s*巻/)?.[1];
  if (explicit) return Number(explicit);
  const trailing = [...value.matchAll(/(?:^|[\s.,:;#()\[\]_-])(\d{1,3})(?=$|[\s.,:;#()\[\]_-])/g)].at(-1)?.[1];
  return trailing ? Number(trailing) : null;
}

function titleStem(value: string | null | undefined) {
  return normalise((value ?? "")
    .replace(/(?:manga|comic|tankobon)/gi, " ")
    .replace(/(?:vol(?:ume)?\.?\s*|第\s*)\d{1,3}(?:\s*巻)?/gi, " ")
    .replace(/\d{1,3}\s*巻/g, " "));
}

function strictTitleStem(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[×✕]/g, "x")
    .replace(/(?:manga|comic|tankobon)/gi, " ")
    .replace(/(?:vol(?:ume)?\.?\s*|第\s*)\d{1,3}(?:\s*巻)?/gi, " ")
    .replace(/\d{1,3}\s*巻/g, " ")
    .replace(/[\s.,:;#()\[\]_-]+/g, "")
    .trim();
}

function languageMatches(candidate: string | null, target: string | null) {
  if (!candidate || !target) return true;
  return normalise(candidate) === normalise(target);
}

function publisherMatches(candidate: string | null, target: string | null) {
  if (!candidate || !target) return true;
  const aliases: Record<string, string> = {
    shueisha: "shueisha",
    集英社: "shueisha",
    vizmedia: "vizmedia",
    vizmediallc: "vizmedia",
  };
  const canonical = (value: string) => aliases[normalise(value)] ?? normalise(value);
  const left = canonical(candidate);
  const right = canonical(target);
  return left.includes(right) || right.includes(left);
}

function japaneseAlias(series: string) {
  const key = normalise(series);
  return Object.entries(JAPANESE_SEARCH_ALIASES).find(([name]) => key.includes(normalise(name)))?.[1] ?? series;
}

function targetTitleNeedles(target: CatalogueDiscoveryTarget) {
  return [target.series, target.title, target.language === "Japanese" && target.series ? japaneseAlias(target.series) : null]
    .map(titleStem)
    .filter((value, index, all) => value.length >= 2 && all.indexOf(value) === index);
}

export function candidateMatchesDiscoveryTarget(candidate: CatalogueSourceCandidate, target: CatalogueDiscoveryTarget) {
  const targetIsbn = cleanIsbn(target.isbn13);
  const candidateIsbn = cleanIsbn(candidate.candidate_isbn_13);
  if (targetIsbn && candidateIsbn) return targetIsbn === candidateIsbn;
  if (!languageMatches(candidate.candidate_language, target.language)) return false;
  if (!publisherMatches(candidate.candidate_publisher, target.publisher)) return false;

  if (candidate.raw_payload.importer === "ndl_search") {
    if (candidate.candidate_format !== "漫画") return false;
    const candidateTitle = strictTitleStem(candidate.candidate_title);
    const strictTargets = [target.series, target.title, target.series ? japaneseAlias(target.series) : null]
      .map(strictTitleStem)
      .filter(Boolean);
    if (!strictTargets.includes(candidateTitle)) return false;
  }

  const candidateStem = titleStem(candidate.candidate_title);
  if (!targetTitleNeedles(target).some((needle) => candidateStem.includes(needle) || needle.includes(candidateStem))) return false;

  const targetVolume = integerVolume(target.volumeNumber);
  if (targetVolume === null) return true;
  const candidateVolume = integerVolume(candidate.candidate_volume_number) ?? volumeFromCatalogueTitle(candidate.candidate_title);
  return candidateVolume === targetVolume;
}

function requestWasDiscovered(requestId: string, queued: CatalogueDiscoveryQueued[]) {
  return queued.some((candidate) => {
    const discovery = candidate.raw_payload?.agent_discovery;
    return discovery && typeof discovery === "object" && (discovery as Record<string, unknown>).request_id === requestId;
  });
}

function queuedDiscoveryIdentity(candidate: CatalogueDiscoveryQueued) {
  const discovery = candidate.raw_payload?.agent_discovery;
  if (!discovery || typeof discovery !== "object") return null;
  const record = discovery as Record<string, unknown>;
  return {
    series: typeof record.series === "string" ? record.series : candidate.candidate_series,
    language: typeof record.language === "string" ? record.language : candidate.candidate_language,
    volume: typeof record.volume_number === "string" ? integerVolume(record.volume_number) : integerVolume(candidate.candidate_volume_number),
  };
}

function priorityIndex(series: string) {
  const value = normalise(series);
  const index = PRIORITY_SERIES.findIndex((priority) => value.includes(normalise(priority)) || normalise(priority).includes(value));
  return index < 0 ? PRIORITY_SERIES.length : index;
}

export function planCatalogueDiscoveryTargets(
  requests: CatalogueDiscoveryRequest[],
  editions: CatalogueDiscoveryEdition[],
  queued: CatalogueDiscoveryQueued[],
  limit = DISCOVERY_TARGET_LIMIT,
) {
  const targets: CatalogueDiscoveryTarget[] = [];
  const tankobonRequests = requests
    .filter((request) => (request.collectible_type ?? "tankobon") === "tankobon" && !requestWasDiscovered(request.id, queued));

  for (const request of tankobonRequests) {
    const language = request.language === "Japanese" || request.language === "English" ? request.language : null;
    const source = language === "Japanese" ? "ndl_search" : "open_library";
    const inferredVolume = volumeFromCatalogueTitle(request.requested_title);
    const volumeNumber = request.volume_number ?? (inferredVolume === null ? null : String(inferredVolume));
    const baseTitle = request.series || request.requested_title;
    const sourceTitle = language === "Japanese" ? japaneseAlias(baseTitle) : baseTitle;
    const query = cleanIsbn(request.isbn_13) || [sourceTitle, volumeNumber].filter(Boolean).join(" ");
    targets.push({
      key: `request:${request.id}`,
      source,
      query,
      title: request.requested_title,
      series: request.series,
      volumeNumber,
      language,
      publisher: request.publisher,
      isbn13: cleanIsbn(request.isbn_13) || null,
      requestId: request.id,
      reason: "collector_request",
    });
    if (targets.length >= limit) return targets;
  }

  const groups = new Map<string, { series: string; language: "English" | "Japanese"; publisher: string | null; volumes: Set<number> }>();
  for (const edition of editions) {
    if ((edition.collectible_type ?? "tankobon") !== "tankobon" || !edition.series || !isPrioritySeries(edition.series)) continue;
    if (edition.language !== "English" && edition.language !== "Japanese") continue;
    const volume = integerVolume(edition.volume_number) ?? volumeFromCatalogueTitle(edition.title);
    if (volume === null) continue;
    const key = `${normalise(edition.series)}:${edition.language}`;
    const group = groups.get(key) ?? { series: edition.series, language: edition.language, publisher: edition.publisher, volumes: new Set<number>() };
    group.volumes.add(volume);
    if (!group.publisher && edition.publisher) group.publisher = edition.publisher;
    groups.set(key, group);
  }

  for (const candidate of queued) {
    const identity = queuedDiscoveryIdentity(candidate);
    if (!identity?.series || (identity.language !== "English" && identity.language !== "Japanese") || identity.volume === null) continue;
    const key = `${normalise(identity.series)}:${identity.language}`;
    groups.get(key)?.volumes.add(identity.volume);
  }

  const orderedGroups = [...groups.values()].sort((left, right) => priorityIndex(left.series) - priorityIndex(right.series) || left.language.localeCompare(right.language));
  for (const group of orderedGroups) {
    const maxVolume = Math.max(...group.volumes);
    let nextVolume = 1;
    while (group.volumes.has(nextVolume) && nextVolume <= maxVolume) nextVolume += 1;
    const source = group.language === "Japanese" ? "ndl_search" : "open_library";
    const sourceTitle = group.language === "Japanese" ? japaneseAlias(group.series) : group.series;
    targets.push({
      key: `gap:${normalise(group.series)}:${group.language}:${nextVolume}`,
      source,
      query: `${sourceTitle} ${nextVolume}`,
      title: `${group.series} Vol. ${nextVolume}`,
      series: group.series,
      volumeNumber: String(nextVolume),
      language: group.language,
      publisher: group.publisher,
      isbn13: null,
      requestId: null,
      reason: "priority_series_gap",
    });
    if (targets.length >= limit) break;
  }

  return targets;
}

function sourceName(source: CatalogueDiscoveryTarget["source"]) {
  return source === "ndl_search" ? "National Diet Library Search" : "Open Library";
}

async function findCandidates(target: CatalogueDiscoveryTarget) {
  return target.source === "ndl_search" ? searchNdlCatalogue(target.query) : searchOpenLibraryCatalogue(target.query);
}

export async function stageCatalogueCandidates(admin: SupabaseClient, runId: string): Promise<CatalogueCuratorResult> {
  const [requestResult, editionResult, queueResult, sourceResult] = await Promise.all([
    admin.from("catalogue_requests").select("id,requested_title,series,volume_number,language,publisher,isbn_13,collectible_type,status").in("status", ["pending", "queued_for_research"]).order("created_at", { ascending: true }).limit(100),
    admin.from("manga_editions").select("title,series,volume_number,language,publisher,isbn_13,collectible_type").eq("is_verified", true).limit(5000),
    admin.from("catalogue_import_queue").select("source_id,external_id,candidate_title,candidate_series,candidate_volume_number,candidate_language,candidate_isbn_13,raw_payload").limit(5000),
    admin.from("sources").select("id,name").in("name", ["National Diet Library Search", "Open Library"]),
  ]);
  const error = requestResult.error || editionResult.error || queueResult.error || sourceResult.error;
  if (error) throw new Error(`Catalogue Curator could not prepare discovery: ${error.message}`);

  const requests = (requestResult.data ?? []) as CatalogueDiscoveryRequest[];
  const editions = (editionResult.data ?? []) as CatalogueDiscoveryEdition[];
  const queued = (queueResult.data ?? []) as CatalogueDiscoveryQueued[];
  const targets = planCatalogueDiscoveryTargets(requests, editions, queued);
  const sources = new Map((sourceResult.data ?? []).map((source) => [source.name as string, source.id as string]));
  const existingKeys = new Set(queued.map((candidate) => `${candidate.source_id}:${candidate.external_id}`));
  const existingIsbns = new Set(editions.map((edition) => cleanIsbn(edition.isbn_13)).filter(Boolean));

  const result: CatalogueCuratorResult = {
    targetsPlanned: targets.length,
    targetsSearched: 0,
    targetsFailed: 0,
    sourceRecordsFound: 0,
    candidatesEligible: 0,
    candidatesStaged: 0,
    candidatesAlreadyQueued: 0,
    candidatesAlreadyPublished: 0,
    targetSummaries: [],
  };

  const discoveries = await Promise.all(targets.map(async (target) => {
    const sourceId = sources.get(sourceName(target.source)) ?? null;
    if (!sourceId) return { target, sourceId, candidates: [] as CatalogueSourceCandidate[], error: "source_not_configured" };
    try {
      return { target, sourceId, candidates: await findCandidates(target), error: null };
    } catch (caught) {
      return {
        target,
        sourceId,
        candidates: [] as CatalogueSourceCandidate[],
        error: caught instanceof Error ? caught.message : "source_failed",
      };
    }
  }));

  for (const discovery of discoveries) {
    const { target, sourceId, candidates } = discovery;
    if (discovery.error || !sourceId) {
      result.targetsFailed += 1;
      result.targetSummaries.push({ key: target.key, source: target.source, result: discovery.error ?? "source_not_configured" });
      continue;
    }
    try {
      result.targetsSearched += 1;
      result.sourceRecordsFound += candidates.length;
      const eligible = candidates.filter((candidate) => (
        candidate.candidate_isbn_13
        && candidate.candidate_publisher
        && candidateMatchesDiscoveryTarget(candidate, target)
      )).sort((left, right) => {
        const leftDate = left.candidate_release_date ?? "9999-12-31";
        const rightDate = right.candidate_release_date ?? "9999-12-31";
        return leftDate.localeCompare(rightDate);
      });
      result.candidatesEligible += eligible.length;
      const rows: Array<Record<string, unknown>> = [];
      for (const candidate of eligible) {
        const key = `${sourceId}:${candidate.external_id}`;
        if (existingKeys.has(key)) {
          result.candidatesAlreadyQueued += 1;
          continue;
        }
        if (existingIsbns.has(cleanIsbn(candidate.candidate_isbn_13))) {
          result.candidatesAlreadyPublished += 1;
          continue;
        }
        const detectedVolume = integerVolume(target.volumeNumber) ?? volumeFromCatalogueTitle(candidate.candidate_title);
        rows.push({
          ...candidate,
          source_id: sourceId,
          candidate_series: target.series,
          candidate_volume_number: detectedVolume === null ? null : String(detectedVolume),
          candidate_language: candidate.candidate_language ?? target.language,
          raw_payload: {
            ...candidate.raw_payload,
            agent_discovery: {
              run_id: runId,
              target_key: target.key,
              reason: target.reason,
              request_id: target.requestId,
              series: target.series,
              volume_number: target.volumeNumber,
              language: target.language,
              query: target.query,
              matched_at: new Date().toISOString(),
            },
          },
        });
        existingKeys.add(key);
        existingIsbns.add(cleanIsbn(candidate.candidate_isbn_13));
        if (rows.length >= CANDIDATES_PER_TARGET) break;
      }

      if (rows.length) {
        const { data: inserted, error: insertError } = await admin.from("catalogue_import_queue").upsert(rows, {
          onConflict: "source_id,external_id",
          ignoreDuplicates: true,
        }).select("id");
        if (insertError) throw insertError;
        result.candidatesStaged += inserted?.length ?? 0;
      }
      result.targetSummaries.push({ key: target.key, source: target.source, result: rows.length ? "staged" : eligible.length ? "already_known" : "no_exact_candidate" });
    } catch (caught) {
      result.targetsFailed += 1;
      result.targetSummaries.push({ key: target.key, source: target.source, result: caught instanceof Error ? caught.message : "source_failed" });
    }
  }

  return result;
}
