import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMarketplaceQuery, type MarketplaceQueryEdition } from "./marketplaceQuery.ts";

type SeedEdition = MarketplaceQueryEdition & {
  id: string;
  title: string | null;
  series: string | null;
  publisher: string | null;
  collectible_type: string | null;
  record_kind: string | null;
};

const PROFILE_SEED_LIMIT = 100;

export function canSeedScoutProfile(edition: SeedEdition) {
  return edition.record_kind === "publication"
    && (edition.collectible_type ?? "tankobon") === "tankobon"
    && Boolean((edition.series ?? edition.title)?.trim())
    && Boolean(String(edition.volume_number ?? "").trim())
    && Boolean(edition.language?.trim())
    && Boolean(edition.publisher?.trim())
    && Boolean(edition.isbn_13?.trim());
}

function scopeNote(edition: SeedEdition) {
  const identity = [
    edition.series ?? edition.title,
    `Vol. ${edition.volume_number}`,
    edition.language,
    edition.publisher,
    edition.isbn_13 ? `ISBN ${edition.isbn_13}` : null,
  ].filter(Boolean).join(", ");
  return `RAR-generated eBay profile for ${identity}. Keep exact-edition matches only; exclude other volumes, publishers, languages, bindings, lots, and sets.`;
}

/**
 * Editions that arrived in a series batch (catalogue_import_queue rows with
 * raw_payload.series_batch) do not get a daily Scout search automatically,
 * except volume 1. A batch can add dozens of volumes at once; each search is
 * daily work for Scout and for the watched-listing job, and most later
 * volumes rarely sell for enough to matter. Staff can still add a search for
 * any of them. Everything that arrives one at a time is seeded as before.
 */
export function skipBatchEdition(edition: Pick<SeedEdition, "id" | "volume_number">, batchEditionIds: Set<string>) {
  return batchEditionIds.has(edition.id) && String(edition.volume_number ?? "").trim() !== "1";
}

export async function seedMissingEbayProfiles(admin: SupabaseClient) {
  const [{ data: source, error: sourceError }, { data: editions, error: editionError }, { data: existing, error: profileError }] = await Promise.all([
    admin.from("sources").select("id").eq("name", "eBay Sold").eq("is_active", true).maybeSingle(),
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,isbn_13,publisher,printing_number,collectible_type,record_kind")
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .eq("collectible_type", "tankobon")
      .not("isbn_13", "is", null)
      .limit(1000),
    admin.from("marketplace_search_profiles").select("edition_id,source:sources!inner(name)").eq("source.name", "eBay Sold").limit(2000),
  ]);
  if (sourceError || !source) throw new Error("RAR could not find the active eBay source for profile creation.");
  if (editionError || profileError) throw new Error("RAR could not check which manga need Scout profiles.");
  const { data: batchRows, error: batchError } = await admin.from("catalogue_import_queue")
    .select("matched_edition_id")
    .not("raw_payload->series_batch", "is", null)
    .not("matched_edition_id", "is", null)
    .limit(5000);
  if (batchError) throw new Error("RAR could not check which manga came in a series batch.");
  const batchEditionIds = new Set((batchRows ?? []).map((row) => row.matched_edition_id as string));

  const existingEditionIds = new Set((existing ?? []).map((profile) => profile.edition_id as string));
  const candidates = ((editions ?? []) as SeedEdition[])
    .filter(canSeedScoutProfile)
    .filter((edition) => !existingEditionIds.has(edition.id))
    .filter((edition) => !skipBatchEdition(edition, batchEditionIds))
    .slice(0, PROFILE_SEED_LIMIT);
  if (!candidates.length) return { created: 0, eligibleMissing: 0 };

  const rows = candidates.map((edition) => ({
    edition_id: edition.id,
    source_id: source.id,
    search_query: buildMarketplaceQuery(edition),
    scope_notes: scopeNote(edition),
    collection_interval_days: 1,
    is_active: true,
  }));
  const { error } = await admin.from("marketplace_search_profiles").insert(rows);
  if (error) throw new Error("RAR could not create the missing eBay Scout profiles.");
  return { created: rows.length, eligibleMissing: candidates.length };
}
