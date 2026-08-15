import Link from "next/link";
import AgentControlCentre from "@/components/AgentControlCentre";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export default async function AgentControlPage() {
  const admin = getSupabaseAdmin();
  const [systemResult, controlsResult, runsResult, actionsResult] = await Promise.all([
    admin.from("agent_system_control").select("global_paused,pause_reason,autonomy_level").eq("singleton", true).maybeSingle(),
    admin.from("agent_controls").select("agent_key,display_name,mission,mode,is_paused,schedule_label").order("created_at"),
    admin.from("agent_runs").select("id,agent_key,status,trigger_source,summary,metrics,error_message,started_at").order("started_at", { ascending: false }).limit(100),
    admin.from("agent_actions").select("id,agent_key,action_type,title,rationale,confidence,status,created_at").neq("action_type", "suggest_print_classification").in("status", ["proposed", "approved", "executed"]).order("created_at", { ascending: false }).limit(100),
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
      {setupError ? <section className="catalogue-content"><div className="review-empty"><strong>The autonomy database is not ready.</strong><p>Apply the 20260817 agent control-plane migration, then reload this page. {setupError.message}</p></div></section> : <AgentControlCentre actions={(actionsResult.data ?? []) as never[]} controls={(controlsResult.data ?? []) as never[]} globalPaused={Boolean(systemResult.data?.global_paused)} pauseReason={systemResult.data?.pause_reason ?? null} runs={(runsResult.data ?? []) as never[]} />}
    </main>
  );
}
