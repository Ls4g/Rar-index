import type { SupabaseClient } from "@supabase/supabase-js";
import { assessEditionMatch } from "./editionMatch";
import { extractListingSignals, listingConflictsWithEdition } from "./liveListings";
import type { ActiveEbayListing } from "./ebayScout";

export type ScoutEdition = {
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  format?: string | null;
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

// Every Scout scan (manual, batch, or the daily cron) builds rows the same
// way. Centralising it means the title-text signal extraction and the
// auto-dismiss rule below stay in one place instead of drifting across three
// near-identical route handlers.
export function buildScoutLeadRow(profileId: string, sourceId: string, edition: ScoutEdition, listing: ActiveEbayListing, checkedAt: string): ScoutLeadBuild {
  const signals = extractListingSignals(listing.title);
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
    match_assessment: assessEditionMatch(edition, {
      title: listing.title,
      series: null,
      volume_number: null,
      language: signals.language,
      isbn_13: signals.isbn13,
      publisher: signals.publisherName,
    }),
    raw_payload: { provider: "ebay_browse", item: listing.rawPayload },
    last_seen_at: checkedAt,
    updated_at: checkedAt,
  };
  return { row, conflictsWithEdition: listingConflictsWithEdition(listing.title, edition) };
}

// Stores this scan's leads, then auto-dismisses only the ones a title-text
// contradiction rules out (a multi-volume lot/set, wrong ISBN, wrong
// publisher, wrong language, or wrong binding) and that no human has touched
// yet. A lead a staff member has already set to
// "watching" or manually "dismissed" is left alone — auto-triage never
// overwrites a human decision, and it never verifies anything as a sale.
export async function storeScoutLeads(admin: SupabaseClient, profileId: string, builds: ScoutLeadBuild[]) {
  if (!builds.length) return;
  const { error } = await admin.from("scout_listing_leads").upsert(builds.map((build) => build.row), { onConflict: "profile_id,source_id,external_id" });
  if (error) throw new Error("RAR could not store the active-listing leads.");

  const conflictExternalIds = builds.filter((build) => build.conflictsWithEdition).map((build) => build.row.external_id);
  if (conflictExternalIds.length) {
    const decisionNotes = "Auto-dismissed: the listing title is a multi-volume lot/set, names a different volume, or conflicts with this edition's ISBN, publisher, language, or binding.";
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
