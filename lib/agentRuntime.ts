import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_LABELS, type AgentKey, type AgentMetrics, planAgentActions } from "@/lib/agentPlanning";
import { refreshStaleScoutAvailability, type ScoutAvailabilityResult } from "@/lib/scoutAvailability";
import { autoDismissDefinitiveScoutConflicts, type AutoTriageResult } from "@/lib/scoutAutoTriage";
import { diagnoseScoutBacklog, readScoutBacklog } from "@/lib/scoutDiagnostics";

type TriggerSource = "manual" | "schedule" | "system";
type AgentControl = { agent_key: AgentKey; mode: string; is_paused: boolean };
type CountResult = { count: number | null; error: { message: string } | null };

function countOrThrow(result: CountResult, label: string) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.count ?? 0;
}

async function collectCatalogueMetrics(admin: SupabaseClient): Promise<AgentMetrics> {
  const [queue, requests, covers] = await Promise.all([
    admin.from("catalogue_import_queue").select("id", { count: "exact", head: true }).in("status", ["pending_review", "needs_review"]),
    admin.from("catalogue_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "queued_for_research"]),
    admin.from("manga_editions").select("id", { count: "exact", head: true }).eq("is_verified", true).neq("cover_verification_status", "verified"),
  ]);
  return {
    catalogue_queue_pending: countOrThrow(queue, "Catalogue queue count failed"),
    catalogue_requests_pending: countOrThrow(requests, "Catalogue request count failed"),
    verified_editions_missing_covers: countOrThrow(covers, "Cover gap count failed"),
  };
}

async function collectScoutMetrics(admin: SupabaseClient): Promise<AgentMetrics> {
  const [{ data: profiles, error: profileError }, backlog, watching] = await Promise.all([
    admin.from("marketplace_search_profiles").select("last_checked_at,collection_interval_days").eq("is_active", true),
    readScoutBacklog(admin),
    admin.from("scout_listing_leads").select("id", { count: "exact", head: true }).eq("review_status", "watching"),
  ]);
  if (profileError) throw new Error(`Search profile scan failed: ${profileError.message}`);
  const now = Date.now();
  const stale = (profiles ?? []).filter((profile) => {
    if (!profile.last_checked_at) return true;
    const interval = Number(profile.collection_interval_days ?? 7) * 86_400_000;
    return now - new Date(profile.last_checked_at).getTime() >= interval;
  }).length;
  const diagnostics = diagnoseScoutBacklog(backlog);
  return {
    active_search_profiles: profiles?.length ?? 0,
    stale_search_profiles: stale,
    new_scout_leads: diagnostics.total,
    scout_review_now: diagnostics.reviewNow,
    scout_strong_matches: diagnostics.strong,
    scout_partial_matches: diagnostics.partial,
    scout_stale_backlog: diagnostics.stale,
    scout_low_confidence: diagnostics.lowConfidence,
    scout_duplicate_rows_grouped: diagnostics.duplicateRows,
    scout_profiles_needing_tuning: diagnostics.profilesNeedingTuning,
    scout_expired_with_end_date: diagnostics.expiredWithEndDate,
    scout_unresolved_conflicts: diagnostics.unresolvedConflicts,
    scout_graded_leads: diagnostics.graded,
    watching_scout_leads: countOrThrow(watching, "Watching Scout lead count failed"),
  };
}

async function collectEvidenceMetrics(admin: SupabaseClient): Promise<AgentMetrics> {
  const [sales, printing, reports] = await Promise.all([
    admin.from("price_observations").select("id", { count: "exact", head: true }).eq("match_status", "needs_review"),
    admin.from("price_observations").select("id", { count: "exact", head: true })
      .eq("match_status", "verified_match").eq("sale_status", "confirmed").eq("print_classification", "printing_not_identified"),
    admin.from("community_sale_reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return {
    sales_needing_review: countOrThrow(sales, "Sale review count failed"),
    sales_needing_print_classification: countOrThrow(printing, "Print classification count failed"),
    community_reports_pending: countOrThrow(reports, "Community report count failed"),
  };
}

async function collectOperatorMetrics(admin: SupabaseClient): Promise<AgentMetrics> {
  const cutoff = new Date(Date.now() - 86_400_000).toISOString();
  const [{ data, error }, failures, openActions, safeActions, autoDismissals] = await Promise.all([
    admin.from("edition_readiness").select("readiness_status"),
    admin.from("agent_runs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("started_at", cutoff),
    admin.from("agent_actions").select("id", { count: "exact", head: true }).in("status", ["proposed", "approved"]),
    admin.from("agent_actions").select("id", { count: "exact", head: true }).eq("status", "executed").gte("executed_at", cutoff),
    admin.from("scout_lead_decisions").select("id", { count: "exact", head: true }).eq("reviewed_by", "RAR Market Scout").gte("created_at", cutoff),
  ]);
  if (error) throw new Error(`Edition readiness scan failed: ${error.message}`);
  const metrics: AgentMetrics = {
    failed_agent_runs_24h: countOrThrow(failures, "Agent failure count failed"),
    open_agent_proposals: countOrThrow(openActions, "Open proposal count failed"),
    safe_agent_actions_24h: countOrThrow(safeActions, "Safe action count failed"),
    scout_auto_dismissals_24h: countOrThrow(autoDismissals, "Scout auto-dismissal count failed"),
  };
  for (const row of data ?? []) {
    const status = String(row.readiness_status ?? "unknown").replace(/[^a-z0-9_]/g, "_");
    metrics[`readiness_${status}`] = (metrics[`readiness_${status}`] ?? 0) + 1;
  }
  return metrics;
}

async function collectMetrics(admin: SupabaseClient, agentKey: AgentKey) {
  if (agentKey === "catalogue_curator") return collectCatalogueMetrics(admin);
  if (agentKey === "market_scout") return collectScoutMetrics(admin);
  if (agentKey === "evidence_auditor") return collectEvidenceMetrics(admin);
  return collectOperatorMetrics(admin);
}

export async function runAgentObservation(
  admin: SupabaseClient,
  agentKey: AgentKey,
  triggerSource: TriggerSource,
  actor: string,
) {
  const [{ data: system, error: systemError }, { data: control, error: controlError }] = await Promise.all([
    admin.from("agent_system_control").select("global_paused,autonomy_level").eq("singleton", true).maybeSingle(),
    admin.from("agent_controls").select("agent_key,mode,is_paused").eq("agent_key", agentKey).maybeSingle(),
  ]);
  if (systemError || controlError || !control) throw new Error("Agent controls are not available. Apply the autonomy migration first.");
  const typedControl = control as AgentControl;
  const blockedReason = system?.global_paused ? "The global agent kill switch is active." : typedControl.is_paused ? `${AGENT_LABELS[agentKey]} is paused.` : null;
  if (blockedReason) {
    const { data: blocked, error } = await admin.from("agent_runs").insert({
      agent_key: agentKey,
      trigger_source: triggerSource,
      status: "blocked",
      mode: typedControl.mode,
      initiated_by: actor,
      summary: blockedReason,
      finished_at: new Date().toISOString(),
    }).select("id,status,summary").single();
    if (error) throw new Error(error.message);
    return blocked;
  }

  const { data: run, error: runError } = await admin.from("agent_runs").insert({
    agent_key: agentKey,
    trigger_source: triggerSource,
    status: "running",
    mode: typedControl.mode,
    initiated_by: actor,
  }).select("id").single();
  if (runError || !run) throw new Error(runError?.message ?? "Could not start the agent run.");

  try {
    let safeActionResult: AutoTriageResult | null = null;
    let availabilityResult: ScoutAvailabilityResult | null = null;
    const autonomyLevel = Number(system?.autonomy_level ?? 1);
    if (agentKey === "market_scout" && autonomyLevel >= 2 && typedControl.mode === "safe_actions") {
      safeActionResult = await autoDismissDefinitiveScoutConflicts(admin, run.id);
      if (safeActionResult.dismissed > 0) {
        const now = new Date().toISOString();
        const { error: actionError } = await admin.from("agent_actions").insert({
          run_id: run.id,
          agent_key: agentKey,
          action_type: "auto_dismiss_scout_conflicts",
          target_type: "scout_listing_leads",
          dedupe_key: `scout:auto-dismiss:${run.id}`,
          title: `Auto-dismissed ${safeActionResult.dismissed} definitive Scout conflicts`,
          rationale: "Every affected lead named an explicit edition conflict and was still untouched when the atomic update ran.",
          risk_level: "low",
          confidence: 1,
          status: "executed",
          evidence: safeActionResult,
          reviewed_by: "RAR Market Scout",
          review_notes: "Phase 2 safe action. No sale was verified and no human decision was overwritten.",
          reviewed_at: now,
          executed_at: now,
        });
        if (actionError) throw new Error(`Market Scout could not audit its safe action: ${actionError.message}`);
      }
    }
    if (agentKey === "market_scout" && autonomyLevel >= 3 && typedControl.mode === "safe_actions") {
      availabilityResult = await refreshStaleScoutAvailability(admin, run.id);
      if (availabilityResult.examined > 0) {
        const now = new Date().toISOString();
        const { error: actionError } = await admin.from("agent_actions").insert({
          run_id: run.id,
          agent_key: agentKey,
          action_type: "refresh_scout_availability",
          target_type: "scout_listing_leads",
          dedupe_key: `scout:availability:${run.id}`,
          title: `Rechecked ${availabilityResult.examined} stale eBay leads`,
          rationale: `${availabilityResult.active} were confirmed active, ${availabilityResult.unavailable} were conclusively unavailable and ${availabilityResult.inconclusive} were left untouched.`,
          risk_level: "low",
          confidence: 1,
          status: "executed",
          evidence: availabilityResult,
          reviewed_by: "RAR Market Scout",
          review_notes: "Phase 3 bounded availability refresh. Inconclusive API results never change a lead decision.",
          reviewed_at: now,
          executed_at: now,
        });
        if (actionError) throw new Error(`Market Scout could not audit its availability refresh: ${actionError.message}`);
      }
    }

    const metrics = await collectMetrics(admin, agentKey);
    if (safeActionResult) {
      metrics.auto_triage_examined = safeActionResult.examined;
      metrics.auto_dismiss_candidates = safeActionResult.candidates;
      metrics.auto_dismissed_leads = safeActionResult.dismissed;
      metrics.auto_dismiss_race_protected = safeActionResult.protectedByRace;
    }
    if (availabilityResult) {
      metrics.availability_examined = availabilityResult.examined;
      metrics.availability_confirmed_active = availabilityResult.active;
      metrics.availability_archived = availabilityResult.unavailable;
      metrics.availability_inconclusive = availabilityResult.inconclusive;
      metrics.availability_race_protected = availabilityResult.protectedByRace;
    }
    const plan = planAgentActions(agentKey, metrics);
    let proposalsCreated = 0;
    for (const item of plan.proposals) {
      const { error } = await admin.from("agent_actions").insert({
        run_id: run.id,
        agent_key: agentKey,
        action_type: item.actionType,
        target_type: item.targetType,
        target_id: item.targetId ?? null,
        dedupe_key: item.dedupeKey,
        title: item.title,
        rationale: item.rationale,
        risk_level: item.riskLevel,
        confidence: item.confidence,
        evidence: item.evidence,
        proposed_payload: item.proposedPayload ?? {},
      });
      if (!error) proposalsCreated += 1;
      else if (error.code !== "23505") throw new Error(`Could not record agent proposal: ${error.message}`);
    }
    const finalMetrics = { ...metrics, proposals_found: plan.proposals.length, proposals_created: proposalsCreated };
    const { data: finished, error } = await admin.from("agent_runs").update({
      status: "succeeded",
      summary: plan.summary,
      metrics: finalMetrics,
      finished_at: new Date().toISOString(),
    }).eq("id", run.id).select("id,status,summary,metrics").single();
    if (error) throw new Error(error.message);
    return finished;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Unknown agent error";
    await admin.from("agent_runs").update({ status: "failed", error_message: message, finished_at: new Date().toISOString() }).eq("id", run.id);
    throw caught;
  }
}
