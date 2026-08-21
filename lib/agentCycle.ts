import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENT_KEYS } from "./agentPlanning.ts";
import { runAgentObservation } from "./agentRuntime.ts";
import { summarizeAgentCycleResults, type CycleAgentResult } from "./agentCyclePolicy.ts";

export async function runGuardedAgentCycle(
  admin: SupabaseClient,
  triggerSource: "manual" | "schedule" | "system",
  actor: string,
) {
  const { data: cycle, error: cycleError } = await admin.from("agent_cycles").insert({
    trigger_source: triggerSource,
    initiated_by: actor,
    total_agents: AGENT_KEYS.length,
  }).select("id,started_at").single();
  if (cycleError || !cycle) throw new Error(cycleError?.message ?? "Could not start the guarded agent cycle.");

  const results: CycleAgentResult[] = [];
  for (const agentKey of AGENT_KEYS) {
    try {
      const run = await runAgentObservation(admin, agentKey, triggerSource, actor, cycle.id);
      results.push({
        agentKey,
        ok: run.status !== "failed",
        status: run.status,
        summary: run.summary,
      });
    } catch (caught) {
      results.push({
        agentKey,
        ok: false,
        status: "failed",
        error: caught instanceof Error ? caught.message : "Unknown agent error",
      });
    }
  }

  const counts = summarizeAgentCycleResults(results);
  const { data: finished, error: finishError } = await admin.rpc("finish_agent_cycle", {
    p_cycle_id: cycle.id,
    p_successful_agents: counts.successful,
    p_failed_agents: counts.failed,
    p_blocked_agents: counts.blocked,
    p_summary: counts.summary,
    p_actor: actor,
  });
  if (finishError) throw new Error(`The agent cycle ran, but its health record could not close: ${finishError.message}`);
  const outcome = Array.isArray(finished) ? finished[0] : finished;
  return { cycleId: cycle.id, ...counts, outcome: outcome ?? null, results };
}

export async function readAgentAutopilotDashboard(admin: SupabaseClient) {
  const [control, cycles, incidents] = await Promise.all([
    admin.from("agent_system_control")
      .select("consecutive_failed_cycles,failure_threshold,auto_pause_on_failure,last_cycle_at,last_healthy_cycle_at,circuit_breaker_reason")
      .eq("singleton", true)
      .maybeSingle(),
    admin.from("agent_cycles")
      .select("id,trigger_source,status,initiated_by,total_agents,successful_agents,failed_agents,blocked_agents,summary,started_at,finished_at")
      .order("started_at", { ascending: false })
      .limit(20),
    admin.from("agent_incidents")
      .select("id,cycle_id,incident_type,severity,status,title,details,created_at,updated_at")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  const missing = [control.error, cycles.error, incidents.error].some((error) => error?.code === "42P01" || error?.code === "PGRST205" || error?.code === "42703");
  if (missing) return { ready: false, control: null, cycles: [], incidents: [] };
  const error = control.error || cycles.error || incidents.error;
  if (error) throw new Error(`Guarded autopilot health could not load: ${error.message}`);
  return { ready: true, control: control.data, cycles: cycles.data ?? [], incidents: incidents.data ?? [] };
}
