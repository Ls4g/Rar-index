import type { SupabaseClient } from "@supabase/supabase-js";
import { isCoveragePrioritySeries } from "./coveragePriority.ts";
import { buildMarketplaceQuery } from "./marketplaceQuery.ts";

type PriorityEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | number | null;
  language: string | null;
  isbn_13: string | null;
  publisher: string | null;
  printing_number: number | null;
};

export type PriorityProfileResult = {
  priorityPublications: number;
  alreadyCovered: number;
  missing: number;
  created: number;
  createdEditionIds: string[];
  missingProfiles: Array<{ editionId: string; query: string }>;
};

export async function ensurePriorityMarketplaceProfiles(admin: SupabaseClient, options: { apply?: boolean } = {}): Promise<PriorityProfileResult> {
  const [{ data: source, error: sourceError }, { data: editionData, error: editionError }] = await Promise.all([
    admin.from("sources").select("id").eq("name", "eBay Sold").eq("is_active", true).maybeSingle(),
    admin.from("manga_editions")
      .select("id,title,series,volume_number,language,isbn_13,publisher,printing_number")
      .eq("is_verified", true).is("printing_of_edition_id", null).limit(5000),
  ]);
  if (sourceError || editionError || !source) throw new Error("Priority coverage could not load its verified editions or eBay source.");

  const editions = ((editionData ?? []) as PriorityEdition[]).filter((edition) => (
    Number.parseInt(String(edition.volume_number ?? ""), 10) === 1
    && (edition.language === "English" || edition.language === "Japanese")
    && isCoveragePrioritySeries(edition.series)
  ));
  const { data: profiles, error: profileError } = editions.length
    ? await admin.from("marketplace_search_profiles").select("edition_id")
      .eq("source_id", source.id).eq("is_active", true).in("edition_id", editions.map((edition) => edition.id))
    : { data: [], error: null };
  if (profileError) throw new Error("Priority coverage could not inspect existing collection profiles.");

  const covered = new Set((profiles ?? []).map((profile) => profile.edition_id as string));
  const missing = editions.filter((edition) => !covered.has(edition.id));
  const missingProfiles = missing.map((edition) => ({ editionId: edition.id, query: buildMarketplaceQuery(edition) }));
  const createdEditionIds: string[] = [];
  for (const edition of options.apply ? missing : []) {
    const { error } = await admin.from("marketplace_search_profiles").insert({
      edition_id: edition.id,
      source_id: source.id,
      search_query: buildMarketplaceQuery(edition),
      scope_notes: `Match ${edition.series ?? edition.title}, Volume 1, ${edition.language}${edition.publisher ? `, ${edition.publisher}` : ""}${edition.isbn_13 ? `, ISBN ${edition.isbn_13}` : ""}. Exclude lots, other volumes, graded copies and records that conflict with these identifiers.`,
      collection_interval_days: 7,
      is_active: true,
    });
    if (error?.code === "23505") continue;
    if (error) throw new Error(`Priority coverage could not create the profile for ${edition.series ?? edition.id}.`);
    createdEditionIds.push(edition.id);
  }

  return {
    priorityPublications: editions.length,
    alreadyCovered: editions.length - missing.length,
    missing: missing.length,
    created: createdEditionIds.length,
    createdEditionIds,
    missingProfiles,
  };
}
