import Link from "next/link";
import AgentControlCentre from "@/components/AgentControlCentre";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readUnlabelledScoutDecisionQueue } from "@/lib/scoutFeedback";
import { readScoutRuleDashboard } from "@/lib/scoutRuleEvaluation";
import { readAgentAutopilotDashboard } from "@/lib/agentCycle";
import { checkEbayConnectionHealth } from "@/lib/ebayScout";

export const dynamic = "force-dynamic";

export default async function AgentControlPage() {
  const admin = getSupabaseAdmin();
  const [systemResult, controlsResult, runsResult, actionsResult, unlabelledResult, ruleDashboardResult, autopilotResult, ebayHealth] = await Promise.all([
    admin.from("agent_system_control").select("global_paused,pause_reason,autonomy_level").eq("singleton", true).maybeSingle(),
    admin.from("agent_controls").select("agent_key,display_name,mission,mode,is_paused,schedule_label").order("created_at"),
    admin.from("agent_runs").select("id,agent_key,status,trigger_source,summary,metrics,error_message,started_at").order("started_at", { ascending: false }).limit(100),
    admin.from("agent_actions").select("id,agent_key,action_type,title,rationale,confidence,status,evidence,proposed_payload,created_at").neq("action_type", "suggest_print_classification").in("status", ["proposed", "approved", "executed"]).order("created_at", { ascending: false }).limit(100),
    readUnlabelledScoutDecisionQueue(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { items: [], total: 0 }, error })),
    readScoutRuleDashboard(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { rules: [], evaluations: [], ready: false }, error })),
    readAgentAutopilotDashboard(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { ready: false, control: null, cycles: [], incidents: [] }, error })),
    checkEbayConnectionHealth(),
  ]);
  const setupError = systemResult.error || controlsResult.error || runsResult.error || actionsResult.error;

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
      {setupError ? <section className="catalogue-content"><div className="review-empty"><strong>The autonomy database is not ready.</strong><p>Apply the 20260817 agent control-plane migration, then reload this page. {setupError.message}</p></div></section> : <AgentControlCentre actions={(actionsResult.data ?? []) as never[]} autopilot={autopilotResult.data as never} controls={(controlsResult.data ?? []) as never[]} ebayHealth={ebayHealth} globalPaused={Boolean(systemResult.data?.global_paused)} historicalDecisions={(unlabelledResult.data?.items ?? []) as never[]} historicalDecisionTotal={unlabelledResult.data?.total ?? 0} pauseReason={systemResult.data?.pause_reason ?? null} ruleDashboard={ruleDashboardResult.data as never} runs={(runsResult.data ?? []) as never[]} />}
    </main>
  );
}
