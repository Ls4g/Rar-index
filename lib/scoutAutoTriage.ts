import type { SupabaseClient } from "@supabase/supabase-js";
import { assessScoutListing, type ScoutEdition } from "./scoutIngest.ts";

const SAFE_CONFLICTS = [
  /^listing appears to be a multi-volume lot or set$/,
  /^volume conflicts with the selected edition$/,
  /^ISBN conflicts with the selected edition$/,
  /^publisher conflicts with the selected edition$/,
  /^language conflicts with the selected edition$/,
  /^binding\/format conflicts with the selected edition$/,
  /^listing states printing \d+, not printing \d+$/,
  /^listing names a different series in the same franchise$/,
  /^listing describes a book, not a magazine issue$/,
  /^issue number conflicts with the selected issue$/,
  /^issue year conflicts with the selected issue$/,
  /^通巻 conflicts with the selected issue$/,
] as const;

type LeadRecord = {
  id: string;
  listing_title: string;
  profile: { edition: ScoutEdition | null } | null;
};

export type ScoutAutoDismissCandidate = {
  lead_id: string;
  decision_notes: string;
  listing_title: string;
  target_title: string | null;
  conflicts: string[];
};

export type AutoTriageDecision = {
  shouldDismiss: boolean;
  conflicts: string[];
  note: string | null;
};

export type AutoTriageResult = {
  examined: number;
  candidates: number;
  dismissed: number;
  protectedByRace: number;
};

function isAllowlistedConflict(reason: string) {
  return SAFE_CONFLICTS.some((pattern) => pattern.test(reason));
}

export function decideScoutAutoDismiss(edition: ScoutEdition, listingTitle: string): AutoTriageDecision {
  const assessment = assessScoutListing(edition, listingTitle);
  const conflicts = assessment.conflicts;
  const shouldDismiss = assessment.confidence === "conflict"
    && conflicts.length > 0
    && conflicts.every(isAllowlistedConflict);
  return {
    shouldDismiss,
    conflicts,
    note: shouldDismiss ? `Auto-dismissed by RAR Market Scout: ${conflicts.join("; ")}.` : null,
  };
}

async function readNewLeads(admin: SupabaseClient) {
  const all: LeadRecord[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 5000; from += pageSize) {
    const { data, error } = await admin
      .from("scout_listing_leads")
      .select("id,listing_title,profile:marketplace_search_profiles!inner(edition:manga_editions!inner(title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no))")
      .eq("review_status", "new")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`Market Scout could not load its lead backlog: ${error.message}`);
    const page = (data ?? []) as unknown as LeadRecord[];
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}

export async function inspectScoutAutoDismissCandidates(admin: SupabaseClient) {
  const leads = await readNewLeads(admin);
  const candidates: ScoutAutoDismissCandidate[] = leads.flatMap((lead) => {
    if (!lead.profile?.edition) return [];
    const decision = decideScoutAutoDismiss(lead.profile.edition, lead.listing_title);
    return decision.shouldDismiss && decision.note
      ? [{
          lead_id: lead.id,
          decision_notes: decision.note,
          listing_title: lead.listing_title,
          target_title: lead.profile.edition.title,
          conflicts: decision.conflicts,
        }]
      : [];
  });
  return { examined: leads.length, candidates };
}

export async function autoDismissDefinitiveScoutConflicts(
  admin: SupabaseClient,
  runId: string,
): Promise<AutoTriageResult> {
  const inspection = await inspectScoutAutoDismissCandidates(admin);
  const decisions = inspection.candidates.map(({ lead_id, decision_notes }) => ({ lead_id, decision_notes }));

  let dismissed = 0;
  for (let offset = 0; offset < decisions.length; offset += 250) {
    const { data, error } = await admin.rpc("apply_scout_agent_auto_dismiss", {
      p_run_id: runId,
      p_items: decisions.slice(offset, offset + 250),
    });
    if (error) throw new Error(`Market Scout could not save its safe dismissals: ${error.message}`);
    dismissed += Number(data ?? 0);
  }

  return {
    examined: inspection.examined,
    candidates: decisions.length,
    dismissed,
    protectedByRace: Math.max(0, decisions.length - dismissed),
  };
}
