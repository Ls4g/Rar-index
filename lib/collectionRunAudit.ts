import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMarketplaceQuery, type MarketplaceQueryEdition } from "@/lib/marketplaceQuery";

type EditionForProfile = MarketplaceQueryEdition & { id: string };

type AutomaticRunInput = {
  profileId: string;
  checkedBy: string;
  candidateCount: number;
  notes: string;
  checkedAt?: string;
};

/** Records provenance at the moment work happens; staff never need to retype it. */
export async function recordAutomaticCollectionRun(admin: SupabaseClient, input: AutomaticRunInput) {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const { data, error } = await admin.from("marketplace_collection_runs").insert({
    profile_id: input.profileId,
    checked_at: checkedAt,
    checked_by: input.checkedBy.trim() || "RAR automation",
    candidate_count: Math.max(0, Math.trunc(input.candidateCount)),
    notes: input.notes.trim() || "Automatically recorded marketplace check.",
  }).select("id,profile_id").single();
  if (error || !data) throw new Error("RAR could not record the automatic collection-run audit.");
  return data as { id: string; profile_id: string };
}

export async function ensureProfileAndRunForEdition(admin: SupabaseClient, input: {
  edition: EditionForProfile;
  sourceId: string;
  checkedBy: string;
  candidateCount: number;
  notes: string;
}) {
  const { data: existing, error: existingError } = await admin.from("marketplace_search_profiles")
    .select("id")
    .eq("edition_id", input.edition.id)
    .eq("source_id", input.sourceId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error("RAR could not locate the edition's collection profile.");

  let profileId = existing?.id as string | undefined;
  if (!profileId) {
    const query = buildMarketplaceQuery(input.edition);
    if (!query) throw new Error("RAR cannot create an audit profile without an edition title.");
    const { data: created, error: createError } = await admin.from("marketplace_search_profiles").insert({
      edition_id: input.edition.id,
      source_id: input.sourceId,
      search_query: query,
      scope_notes: "Automatically created when staff submitted completed-sale evidence. Exact-edition review rules still apply.",
      collection_interval_days: 7,
      is_active: true,
    }).select("id").single();
    if (createError || !created) throw new Error("RAR could not create the edition's collection profile.");
    profileId = created.id as string;
  }

  return recordAutomaticCollectionRun(admin, {
    profileId,
    checkedBy: input.checkedBy,
    candidateCount: input.candidateCount,
    notes: input.notes,
  });
}
