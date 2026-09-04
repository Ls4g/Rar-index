import Link from "next/link";
import AgentLearningWorkbench from "@/components/AgentLearningWorkbench";
import AgentReliabilityDashboard from "@/components/AgentReliabilityDashboard";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readScoutRuleDashboard } from "@/lib/scoutRuleEvaluation";
import { readReliabilityDashboard } from "@/lib/agentReliability";

export const dynamic = "force-dynamic";

export default async function AgentLearningPage() {
  const admin = getSupabaseAdmin();
  const [rulesResult, reliabilityResult] = await Promise.all([
    readScoutRuleDashboard(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { rules: [], evaluations: [], ready: false }, error })),
    readReliabilityDashboard(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { ready: false, suites: [], operator: null }, error })),
  ]);

  return (
    <main className="review-page catalogue-page agent-control-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <StaffNav current="/agent-learning" />
      </header>
      <section className="review-hero catalogue-hero agent-hero">
        <div><p className="eyebrow">Controlled learning</p><h1>Agent reliability</h1><p>Measure what every RAR agent gets right, catch regressions, and keep human approval between a recommendation and publication.</p></div>
        <div className="queue-total"><strong>Automatic</strong><span>Watch and Dismiss decisions feed learning</span></div>
      </section>
      <AgentReliabilityDashboard dashboard={reliabilityResult.data as never} />
      {rulesResult.error ? <section className="catalogue-content"><div className="review-empty"><strong>The Scout learning tools could not load completely.</strong><p>{rulesResult.error.message}</p></div></section> : <AgentLearningWorkbench ruleDashboard={rulesResult.data as never} />}
    </main>
  );
}
