import {
  candidateMatchesDiscoveryTarget,
  cataloguePublisherMatches,
  type CatalogueDiscoveryTarget,
} from "./catalogueCurator.ts";
import { catalogueMetadataProblem, queuedReviewMetadata } from "./catalogueReviewMetadata.ts";
import type { CatalogueSourceCandidate } from "./catalogueSources.ts";

export type CatalogueApprovalQueueRow = {
  external_id: string;
  source_record_url: string;
  raw_payload: Record<string, unknown> | null;
  candidate_kind: "edition_candidate" | "series_reference";
  candidate_title: string;
  candidate_series: string | null;
  candidate_volume_number: string | null;
  candidate_author: string | null;
  candidate_publisher: string | null;
  candidate_language: string | null;
  candidate_isbn_13: string | null;
  candidate_release_date: string | null;
  candidate_format?: string | null;
  candidate_cover_image_url?: string | null;
};

export type KnownCatalogueEdition = {
  series: string | null;
  language: string | null;
  publisher: string | null;
};

type AgentDiscovery = {
  target_key?: unknown;
  title?: unknown;
  query?: unknown;
  series?: unknown;
  volume_number?: unknown;
  language?: unknown;
  publisher?: unknown;
  isbn_13?: unknown;
  source?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value.trim() || null : null;
}

function normalise(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[×✕✖]/g, "x")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function discoveryFromPayload(rawPayload: Record<string, unknown> | null) {
  const value = rawPayload?.agent_discovery;
  return value && typeof value === "object" ? value as AgentDiscovery : null;
}

function asCandidate(row: CatalogueApprovalQueueRow): CatalogueSourceCandidate {
  return {
    external_id: row.external_id,
    source_record_url: row.source_record_url,
    raw_payload: row.raw_payload ?? {},
    candidate_kind: "edition_candidate",
    candidate_title: row.candidate_title,
    candidate_series: row.candidate_series,
    candidate_volume_number: row.candidate_volume_number,
    candidate_author: row.candidate_author,
    candidate_publisher: row.candidate_publisher,
    candidate_language: row.candidate_language,
    candidate_isbn_13: row.candidate_isbn_13,
    candidate_release_date: row.candidate_release_date,
    candidate_format: row.candidate_format ?? null,
    candidate_cover_image_url: row.candidate_cover_image_url ?? null,
  };
}

function targetFromDiscovery(discovery: AgentDiscovery): CatalogueDiscoveryTarget | null {
  const series = text(discovery.series);
  const title = text(discovery.title) ?? series ?? text(discovery.query);
  const targetKey = text(discovery.target_key);
  if (!title || !targetKey) return null;
  const sourceValue = text(discovery.source);
  return {
    key: targetKey,
    source: sourceValue === "shueisha_direct" ? "shueisha_direct" : "open_library",
    query: text(discovery.query) ?? title,
    title,
    series,
    volumeNumber: text(discovery.volume_number),
    language: text(discovery.language),
    publisher: text(discovery.publisher),
    isbn13: text(discovery.isbn_13),
    requestId: null,
    reason: "lane_series_gap",
  };
}

/**
 * Re-check an automatically discovered candidate at the final approval
 * boundary. Older queue rows remain reviewable, but a stale false match can
 * no longer be published just because it entered the queue before the
 * Curator's current matching rules existed.
 */
export function catalogueApprovalProblem(
  row: CatalogueApprovalQueueRow,
  knownEditions: KnownCatalogueEdition[],
) {
  const discovery = discoveryFromPayload(row.raw_payload);
  if (!discovery) return null;
  const target = targetFromDiscovery(discovery);
  if (!target) return "This automated candidate has lost its discovery target. Keep it in review instead of publishing it.";
  if (!candidateMatchesDiscoveryTarget(asCandidate(row), target)) {
    return "This source record no longer matches the Curator target's series, volume, language, or ISBN. Reject it or keep it in review.";
  }

  const expectedPublishers = [text(discovery.publisher), ...knownEditions
    .filter((edition) => (
      normalise(edition.series) === normalise(target.series)
      && normalise(edition.language) === normalise(target.language)
    ))
    .map((edition) => edition.publisher)]
    .filter((publisher): publisher is string => Boolean(publisher));

  if (expectedPublishers.length && !expectedPublishers.some((publisher) => cataloguePublisherMatches(row.candidate_publisher, publisher))) {
    return `Publisher conflict: this source says ${row.candidate_publisher ?? "publisher unknown"}, while RAR's verified ${target.language ?? "target"} records use ${[...new Set(expectedPublishers)].join(" or ")}.`;
  }
  return null;
}

/**
 * Why a queued candidate cannot be approved in one click from the Decisions
 * inbox, or null when it can be.
 *
 * The inbox offers a single "Yes — add edition" button with no fields, so it
 * may only offer that button when approval can actually succeed. The catalogue
 * API refuses approve_new without a language, without complete source-owned
 * review metadata, or when the Curator guard finds a conflict; a candidate
 * hitting any of those has to go to /catalogue-review, where the reviewer can
 * supply the missing fact. Language is deliberately left blank by the Curator
 * rather than guessed, so a blank one is a question for a human, not a defect.
 */
export function catalogueOneClickApprovalBlocker(
  row: CatalogueApprovalQueueRow,
  knownEditions: KnownCatalogueEdition[],
) {
  if (row.candidate_kind !== "edition_candidate") return "A series reference cannot create a physical edition on its own.";
  if (!row.candidate_title?.trim()) return "The source record has no usable title.";
  if (!row.candidate_language) return "The source did not state a language, so it has to be confirmed by hand.";
  if (row.candidate_isbn_13 && !/^97[89]\d{10}$/.test(row.candidate_isbn_13.replace(/[^0-9Xx]/g, "").toUpperCase())) {
    return "The ISBN on this source record is not a valid ISBN-13.";
  }
  const metadataProblem = catalogueMetadataProblem(queuedReviewMetadata(row.raw_payload));
  if (metadataProblem) return metadataProblem;
  return catalogueApprovalProblem(row, knownEditions);
}
