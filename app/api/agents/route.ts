import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { isAgentKey } from "@/lib/agentPlanning";
import { runAgentObservation } from "@/lib/agentRuntime";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "A valid agent command is required." }, { status: 400 });
  }

  const command = clean(payload.command);
  const reviewer = clean(payload.reviewer);
  if (!reviewer) return Response.json({ error: "Enter your staff name before using agent controls." }, { status: 400 });
  const admin = getSupabaseAdmin();

  try {
    if (command === "run_agent") {
      if (!isAgentKey(payload.agentKey)) return Response.json({ error: "Choose a valid RAR agent." }, { status: 400 });
      const run = await runAgentObservation(admin, payload.agentKey, "manual", reviewer);
      return Response.json({ run });
    }

    if (command === "set_agent_paused") {
      if (!isAgentKey(payload.agentKey) || typeof payload.paused !== "boolean") return Response.json({ error: "Choose an agent and pause state." }, { status: 400 });
      const { error } = await admin.from("agent_controls").update({ is_paused: payload.paused, updated_by: reviewer }).eq("agent_key", payload.agentKey);
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }

    if (command === "set_global_paused") {
      if (typeof payload.paused !== "boolean") return Response.json({ error: "Choose a global pause state." }, { status: 400 });
      const { error } = await admin.from("agent_system_control").update({
        global_paused: payload.paused,
        pause_reason: payload.paused ? clean(payload.reason) || `Paused by ${reviewer}` : null,
        updated_by: reviewer,
      }).eq("singleton", true);
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }

    if (command === "review_action") {
      const actionId = clean(payload.actionId);
      const decision = clean(payload.decision);
      if (!actionId || !["approved", "rejected", "cancelled"].includes(decision)) return Response.json({ error: "Choose a proposal and valid decision." }, { status: 400 });
      const { data, error } = await admin.from("agent_actions").update({
        status: decision,
        reviewed_by: reviewer,
        review_notes: clean(payload.notes) || null,
        reviewed_at: new Date().toISOString(),
      }).eq("id", actionId).eq("status", "proposed").select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return Response.json({ error: "This proposal was already reviewed." }, { status: 409 });
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown agent command." }, { status: 400 });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "The agent command failed." }, { status: 500 });
  }
}
