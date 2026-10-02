import Link from "next/link";
import AgentControlCentre from "@/components/AgentControlCentre";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readAgentAutopilotDashboard } from "@/lib/agentCycle";
import { checkEbayConnectionHealth } from "@/lib/ebayScout";
import { diagnoseScoutBacklog, readScoutBacklog } from "@/lib/scoutDiagnostics";
import { priorShadowRuleForAction, type PriorScoutRule } from "@/lib/scoutRuleEvaluation";

export const dynamic = "force-dynamic";

export default async function AgentControlPage() {
  const admin = getSupabaseAdmin();
  const [systemResult, controlsResult, runsResult, actionsResult, autopilotResult, ebayHealth, scoutPriorityResult, rulesResult] = await Promise.all([
    admin.from("agent_system_control").select("global_paused,pause_reason,autonomy_level").eq("singleton", true).maybeSingle(),
    admin.from("agent_controls").select("agent_key,display_name,mission,mode,is_paused,schedule_label").order("created_at"),
    admin.from("agent_runs").select("id,agent_key,status,trigger_source,summary,metrics,error_message,started_at").order("started_at", { ascending: false }).limit(100),
    admin.from("agent_actions").select("id,agent_key,action_type,title,rationale,confidence,status,evidence,proposed_payload,created_at").neq("action_type", "suggest_print_classification").in("status", ["proposed", "approved", "executed"]).order("created_at", { ascending: false }).limit(100),
    readAgentAutopilotDashboard(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { ready: false, control: null, cycles: [], incidents: [] }, error })),
    checkEbayConnectionHealth(),
    readScoutBacklog(admin).then((leads) => ({ data: diagnoseScoutBacklog(leads).reviewNow, error: null })).catch((error: Error) => ({ data: null, error })),
    admin.from("scout_rule_versions").select("id,rule_key,rule_type,version,config,status,tested_at,evaluation_metrics")
      .in("rule_key", ["first-print-proof", "multi-volume-language", "edition-conflict-language"])
      .order("created_at", { ascending: false }).limit(1000),
  ]);
  const setupError = systemResult.error || controlsResult.error || runsResult.error || actionsResult.error;
  type RuleRow = PriorScoutRule & { tested_at: string | null; evaluation_metrics: Record<string, unknown> | null };
  const rules = (rulesResult.data ?? []) as RuleRow[];
  const visibleActions = (actionsResult.data ?? []).filter((action) => {
    if (action.status !== "proposed" || !action.action_type.startsWith("shadow_test_") || rulesResult.error) return true;
    try {
      return !priorShadowRuleForAction({ action_type: action.action_type, evidence: action.evidence as Record<string, unknown> | null }, rules);
    } catch {
      return false; // No safe candidate can be built from this evidence.
    }
  });
  const latestRules = new Map<string, RuleRow>();
  for (const rule of rules) if (!latestRules.has(rule.rule_key)) latestRules.set(rule.rule_key, rule);
  const learningTests = [...latestRules.values()].map((rule) => ({
    ruleKey: rule.rule_key, version: rule.version, status: rule.status, testedAt: rule.tested_at,
    passed: typeof rule.evaluation_metrics?.passed === "boolean" ? rule.evaluation_metrics.passed : null,
    gates: (rule.evaluation_metrics?.gates ?? {}) as Record<string, { passed: boolean; actual: number; required: number }>,
  }));

  return (
    <main className="review-page catalogue-page agent-control-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <StaffNav current="/agents" />
      </header>
      <section className="review-hero catalogue-hero agent-hero">
        <div><p className="eyebrow">Staff automation</p><h1>Agents</h1><p>See what needs your attention, run a task when needed, and leave technical history folded away unless you are investigating something.</p></div>
        <div className="queue-total"><strong>{systemResult.data?.autonomy_level ?? 1}</strong><span>autonomy level</span></div>
      </section>
      {setupError ? <section className="catalogue-content"><div className="review-empty"><strong>The autonomy database is not ready.</strong><p>Apply the 20260817 agent control-plane migration, then reload this page. {setupError.message}</p></div></section> : <AgentControlCentre actions={visibleActions as never[]} autopilot={autopilotResult.data as never} controls={(controlsResult.data ?? []) as never[]} ebayHealth={ebayHealth} globalPaused={Boolean(systemResult.data?.global_paused)} learningTests={learningTests} learningResultsError={rulesResult.error?.message ?? null} pauseReason={systemResult.data?.pause_reason ?? null} runs={(runsResult.data ?? []) as never[]} scoutPriorityCount={scoutPriorityResult.data} />}
    </main>
  );
}
