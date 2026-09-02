import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { isAgentKey } from "@/lib/agentPlanning";
import { runAgentObservation } from "@/lib/agentRuntime";
import { createAndEvaluateScoutRule, reevaluateScoutRule } from "@/lib/scoutRuleEvaluation";
import { runGuardedAgentCycle } from "@/lib/agentCycle";
import { checkEbayConnectionHealth } from "@/lib/ebayScout";
import { agentActionExecutionKind, preflightAgentAction } from "@/lib/agentActionExecution";
import { runScoutBatch } from "@/lib/scoutBatch";
import { recordAgentHumanFeedback } from "@/lib/agentHumanFeedback";

export const maxDuration = 60;

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
    if (command === "test_ebay_connection") {
      const health = await checkEbayConnectionHealth();
      return Response.json({ health });
    }

    if (command === "run_guarded_cycle") {
      const cycle = await runGuardedAgentCycle(admin, "manual", reviewer);
      return Response.json({ cycle });
    }

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
      const controlUpdate = payload.paused
        ? { global_paused: true, pause_reason: clean(payload.reason) || `Paused by ${reviewer}`, updated_by: reviewer }
        : { global_paused: false, pause_reason: null, consecutive_failed_cycles: 0, circuit_breaker_reason: null, updated_by: reviewer };
      const { error } = await admin.from("agent_system_control").update(controlUpdate).eq("singleton", true);
      if (error) throw new Error(error.message);
      if (!payload.paused) {
        const { error: incidentError } = await admin.from("agent_incidents").update({
          status: "resolved",
          resolved_by: reviewer,
          resolved_at: new Date().toISOString(),
          resolution_notes: "Circuit breaker reviewed and automation resumed by staff.",
        }).eq("incident_key", "agent-circuit-breaker").eq("status", "open");
        if (incidentError) throw new Error(incidentError.message);
      }
      return Response.json({ ok: true });
    }

    if (command === "resolve_agent_incident") {
      const incidentId = clean(payload.incidentId);
      if (!incidentId) return Response.json({ error: "Choose an open incident." }, { status: 400 });
      const { error } = await admin.rpc("resolve_agent_incident", {
        p_incident_id: incidentId,
        p_resolved_by: reviewer,
        p_notes: clean(payload.notes),
      });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }

    if (command === "review_action") {
      const actionId = clean(payload.actionId);
      const decision = clean(payload.decision);
      const execute = payload.execute === true;
      if (!actionId || !["approved", "rejected", "cancelled"].includes(decision)) return Response.json({ error: "Choose a proposal and valid decision." }, { status: 400 });
      const { data: action, error: actionError } = await admin.from("agent_actions")
        .select("id,action_type,status,target_type,target_id,evidence,proposed_payload")
        .eq("id", actionId)
        .eq("status", "proposed")
        .maybeSingle();
      if (actionError) throw new Error(actionError.message);
      if (!action) return Response.json({ error: "This proposal was already reviewed." }, { status: 409 });

      let rule = null;
      let execution = null;
      const executionKind = agentActionExecutionKind(action.action_type);
      if (execute && decision !== "approved") return Response.json({ error: "Only an approved proposal can be run." }, { status: 400 });
      if (execute && !executionKind) return Response.json({ error: "This recommendation does not have a safe automatic execution path yet." }, { status: 400 });
      const preflight = execute ? preflightAgentAction(action) : null;
      if (execute && preflight && !preflight.ok) {
        await admin.from("agent_action_events").insert({
          action_id: action.id,
          previous_status: action.status,
          next_status: "preflight_failed",
          actor: reviewer,
          notes: "Execution stopped before any work was performed.",
          details: { checks: preflight.checks },
        });
        return Response.json({ error: "The proposal is no longer safe to run. Review its failed preflight checks.", preflight }, { status: 409 });
      }

      if (execute) {
        const { data: claimed, error: claimError } = await admin.from("agent_actions").update({
          status: "approved",
          reviewed_by: reviewer,
          review_notes: clean(payload.notes) || "Approved after execution preflight passed.",
          reviewed_at: new Date().toISOString(),
        }).eq("id", actionId).eq("status", "proposed").select("id").maybeSingle();
        if (claimError) throw new Error(claimError.message);
        if (!claimed) return Response.json({ error: "This proposal was already reviewed or claimed by another request." }, { status: 409 });
        await admin.from("agent_action_events").insert({
          action_id: action.id,
          previous_status: "proposed",
          next_status: "preflight_passed",
          actor: reviewer,
          notes: "Typed action contract passed before execution.",
          details: { checks: preflight?.checks ?? [] },
        });
      }

      try {
        if (decision === "approved" && action.action_type.startsWith("shadow_test_")) {
          const phrases = Array.isArray(payload.rulePhrases)
            ? payload.rulePhrases.map(clean).filter(Boolean)
            : clean(payload.rulePhrases).split(",").map((item) => item.trim()).filter(Boolean);
          rule = await createAndEvaluateScoutRule(admin, action, reviewer, phrases);
        }
        if (decision === "approved" && execute && executionKind === "scan_stale_profiles") {
          execution = await runScoutBatch(admin, { limit: 20, dueOnly: true });
        }
      } catch (executionError) {
        if (execute) {
          const failureMessage = executionError instanceof Error ? executionError.message : "Execution failed.";
          await admin.from("agent_actions").update({
            status: "proposed",
            reviewed_by: null,
            review_notes: null,
            reviewed_at: null,
          }).eq("id", actionId).eq("status", "approved");
          await admin.from("agent_action_events").insert({
            action_id: action.id,
            previous_status: "approved",
            next_status: "execution_failed",
            actor: reviewer,
            notes: "Execution failed and the proposal was safely returned to the inbox.",
            details: { error: failureMessage },
          });
        }
        throw executionError;
      }

      const finalStatus = decision === "approved" && execute ? "executed" : decision;
      const suppliedNotes = clean(payload.notes);
      const executionNotes = execution
        ? `Approved and ran a coverage-aware Scout batch: ${execution.discoveryProfiles} profiles needing listings and ${execution.maintenanceProfiles} maintenance profiles checked, ${execution.activeLeads} active leads found and ${execution.failures} failures.`
        : rule && execute
          ? "Approved and ran the proposed Scout shadow test. The candidate rule still requires separate activation."
          : "";

      const expectedStatus = execute ? "approved" : "proposed";
      const { data, error } = await admin.from("agent_actions").update({
        status: finalStatus,
        reviewed_by: reviewer,
        review_notes: suppliedNotes || executionNotes || null,
        reviewed_at: new Date().toISOString(),
        ...(finalStatus === "executed" ? { executed_at: new Date().toISOString() } : {}),
      }).eq("id", actionId).eq("status", expectedStatus).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return Response.json({ error: "This proposal was already reviewed." }, { status: 409 });
      await recordAgentHumanFeedback(admin, {
        workflow: "agent_action",
        subjectKeys: [`agent_action:${actionId}`],
        outcome: finalStatus,
        reasonLabel: clean(payload.feedbackReason),
        note: suppliedNotes,
        reviewedBy: reviewer,
      });
      const message = execution
        ? `Plan approved and run: ${execution.scannedProfiles} stale profiles checked and ${execution.activeLeads} active leads found.`
        : rule && execute
          ? "Plan approved and the shadow test ran. Its candidate rule was not activated automatically."
          : "Plan decision saved.";
      return Response.json({ ok: true, rule, execution, status: finalStatus, message });
    }

    if (command === "reevaluate_scout_rule") {
      const ruleVersionId = clean(payload.ruleVersionId);
      if (!ruleVersionId) return Response.json({ error: "Choose a candidate rule." }, { status: 400 });
      const rule = await reevaluateScoutRule(admin, ruleVersionId, reviewer);
      return Response.json({ ok: true, rule });
    }

    if (command === "activate_scout_rule") {
      const ruleVersionId = clean(payload.ruleVersionId);
      if (!ruleVersionId) return Response.json({ error: "Choose a passing rule." }, { status: 400 });
      const { error } = await admin.rpc("activate_scout_rule_version", { p_rule_version_id: ruleVersionId, p_approved_by: reviewer });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }

    if (command === "rollback_scout_rule") {
      const ruleVersionId = clean(payload.ruleVersionId);
      if (!ruleVersionId) return Response.json({ error: "Choose a superseded rule to restore." }, { status: 400 });
      const { error } = await admin.rpc("rollback_scout_rule_version", { p_target_rule_version_id: ruleVersionId, p_approved_by: reviewer });
      if (error) throw new Error(error.message);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Unknown agent command." }, { status: 400 });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "The agent command failed." }, { status: 500 });
  }
}
