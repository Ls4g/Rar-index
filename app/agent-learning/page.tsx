import Link from "next/link";
import AgentLearningWorkbench from "@/components/AgentLearningWorkbench";
import StaffNav from "@/components/StaffNav";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { readUnlabelledScoutDecisionQueue } from "@/lib/scoutFeedback";
import { readScoutRuleDashboard } from "@/lib/scoutRuleEvaluation";

export const dynamic = "force-dynamic";

export default async function AgentLearningPage() {
  const admin = getSupabaseAdmin();
  const [decisionsResult, rulesResult] = await Promise.all([
    readUnlabelledScoutDecisionQueue(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { items: [], total: 0 }, error })),
    readScoutRuleDashboard(admin).then((data) => ({ data, error: null })).catch((error: Error) => ({ data: { rules: [], evaluations: [], ready: false }, error })),
  ]);

  return (
    <main className="review-page catalogue-page agent-control-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <StaffNav current="/agent-learning" />
      </header>
      <section className="review-hero catalogue-hero agent-hero">
        <div><p className="eyebrow">Controlled learning</p><h1>Scout learning</h1><p>Label past human decisions and inspect proposed scoring rules without crowding the daily Agents dashboard.</p></div>
        <div className="queue-total"><strong>{decisionsResult.data.total}</strong><span>decisions still need a reason</span></div>
      </section>
      {decisionsResult.error || rulesResult.error ? <section className="catalogue-content"><div className="review-empty"><strong>The learning workspace could not load completely.</strong><p>{decisionsResult.error?.message ?? rulesResult.error?.message}</p></div></section> : <AgentLearningWorkbench historicalDecisions={decisionsResult.data.items as never[]} historicalDecisionTotal={decisionsResult.data.total} ruleDashboard={rulesResult.data as never} />}
    </main>
  );
}
