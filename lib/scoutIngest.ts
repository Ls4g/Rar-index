import type { SupabaseClient } from "@supabase/supabase-js";
import { assessEditionMatch, type EditionMatchAssessment, type EditionMatchCandidate } from "./editionMatch";
import { detectFormatWord, extractListingSignals, hasMatchingVolume, listingConflictsWithEdition, listingIsMultiVolumeLot, listingNamesOtherVolume } from "./liveListings";
import type { ActiveEbayListing } from "./ebayScout";

export type ScoutEdition = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  format?: string | null;
  printing_number?: number | null;
  edition_statement?: string | null;
  variant_name?: string | null;
  collectible_type?: string | null;
  issue_year?: number | null;
  issue_number_label?: string | null;
  cumulative_issue_no?: number | null;
};

export type ScoutLeadRow = {
  profile_id: string;
  source_id: string;
  external_id: string;
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  listing_condition: string | null;
  item_end_at: string | null;
  match_assessment: ReturnType<typeof assessEditionMatch>;
  raw_payload: unknown;
  last_seen_at: string;
  updated_at: string;
};

export type ScoutLeadBuild = { row: ScoutLeadRow; conflictsWithEdition: boolean };

// Reads everything a match assessment needs directly out of listing text.
// Volume gets resolved to either the target's own volume number (a
// confirmed match), a different number actually named in the title (a
// confirmed conflict), or null (not mentioned at all) — the same
// match/conflict/unknown distinction assessEditionMatch already keeps for
// every other field, rather than leaving volume permanently blank the way
// live Scout ingestion did before.
export function buildCandidateFromListing(edition: ScoutEdition, listingTitle: string): EditionMatchCandidate {
  const signals = extractListingSignals(listingTitle);
  const matchesVolume = hasMatchingVolume(listingTitle, edition.volume_number);
  const otherVolume = listingNamesOtherVolume(listingTitle, edition.volume_number);
  return {
    title: listingTitle,
    series: null,
    volume_number: matchesVolume && edition.volume_number ? String(edition.volume_number) : otherVolume,
    language: signals.language,
    isbn_13: signals.isbn13,
    publisher: signals.publisherName,
    format: detectFormatWord(listingTitle),
  };
}

// The single scoring path for a Scout listing, used both when a scan first
// stores a lead and whenever the Scout Triage Inbox re-renders one — so a
// scoring-rule change takes effect immediately for every already-stored
// lead without a data migration. A multi-volume lot/set is a plain-text
// pattern or a whole-listing shape, not a structured field to weigh
// alongside the others, so it is layered on afterwards as a hard conflict
// rather than folded into assessEditionMatch itself (which stays identical
// for its other caller, CSV price-import matching).
export function assessScoutListing(edition: ScoutEdition, listingTitle: string): EditionMatchAssessment {
  const candidate = buildCandidateFromListing(edition, listingTitle);
  const assessment = assessEditionMatch(edition, candidate);
  if (listingIsMultiVolumeLot(listingTitle, edition.volume_number)) {
    return { ...assessment, confidence: "conflict", conflicts: [...assessment.conflicts, "listing appears to be a multi-volume lot or set"] };
  }
  return assessment;
}

// Every Scout scan (manual, batch, or the daily cron) builds rows the same
// way. Centralising it means the title-text signal extraction and the
// auto-dismiss rule below stay in one place instead of drifting across three
// near-identical route handlers.
export function buildScoutLeadRow(profileId: string, sourceId: string, edition: ScoutEdition, listing: ActiveEbayListing, checkedAt: string): ScoutLeadBuild {
  const row: ScoutLeadRow = {
    profile_id: profileId,
    source_id: sourceId,
    external_id: listing.externalId,
    source_listing_url: listing.url,
    listing_title: listing.title,
    listing_price: Number.isFinite(listing.price) ? listing.price : null,
    currency: listing.currency,
    listing_condition: listing.condition,
    item_end_at: listing.itemEndAt,
    match_assessment: assessScoutListing(edition, listing.title),
    raw_payload: { provider: "ebay_browse", item: listing.rawPayload },
    last_seen_at: checkedAt,
    updated_at: checkedAt,
  };
  return { row, conflictsWithEdition: row.match_assessment.confidence === "conflict" || listingConflictsWithEdition(listing.title, edition) };
}

// Stores this scan's leads, then auto-dismisses only the ones a title-text
// contradiction rules out (a multi-volume lot/set, wrong ISBN, wrong
// publisher, language, binding, printing, or series identity) and that no human has touched
// yet. A lead a staff member has already set to
// "watching" or manually "dismissed" is left alone — auto-triage never
// overwrites a human decision, and it never verifies anything as a sale.
export async function storeScoutLeads(admin: SupabaseClient, profileId: string, builds: ScoutLeadBuild[]) {
  if (!builds.length) return;
  const { error } = await admin.from("scout_listing_leads").upsert(builds.map((build) => build.row), { onConflict: "profile_id,source_id,external_id" });
  if (error) throw new Error("RAR could not store the active-listing leads.");

  const conflictExternalIds = builds.filter((build) => build.conflictsWithEdition).map((build) => build.row.external_id);
  if (conflictExternalIds.length) {
    const decisionNotes = "Auto-dismissed: the listing title is a multi-volume lot/set, names a different volume/printing/series, or conflicts with this edition's ISBN, publisher, language, or binding.";
    const { data: dismissed } = await admin
      .from("scout_listing_leads")
      .update({ review_status: "dismissed", review_notes: decisionNotes, reviewed_by: "RAR Auto-Triage" })
      .eq("profile_id", profileId)
      .in("external_id", conflictExternalIds)
      .eq("review_status", "new")
      .select("id");
    if (dismissed?.length) {
      await admin.from("scout_lead_decisions").insert(
        dismissed.map((row) => ({ lead_id: row.id, decision: "dismissed", decision_notes: decisionNotes, reviewed_by: "RAR Auto-Triage" })),
      );
    }
  }
}
