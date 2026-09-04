"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

type Gate = { passed?: boolean; actual?: number; required?: number };
type LatestRun = {
  id: string;
  passed: boolean;
  case_count: number;
  positive_count: number;
  negative_count: number;
  distinct_subjects: number;
  regression_count: number;
  metrics: Record<string, number>;
  gates: Record<string, Gate>;
  created_at: string;
};
type Failure = { expected_outcome: string; predicted_outcome: string; critical_failure: boolean; case: { subject_key: string; reason_label: string | null } | null };
type Suite = { evaluatorKey: string; latest: LatestRun | null; failures?: Failure[] };
type Dashboard = {
  ready: boolean;
  suites: Suite[];
  operator: { examined: number; completed: number; attention: number; reliability: number | null } | null;
};

const LABELS: Record<string, { agent: string; title: string }> = {
  market_scout_match: { agent: "Market Scout", title: "Listing decisions" },
  catalogue_curator_guard: { agent: "Catalogue Curator", title: "Edition candidates" },
  evidence_sale_guard: { agent: "Evidence Auditor", title: "Completed-sale evidence" },
  evidence_print_guard: { agent: "Evidence Auditor", title: "Printing evidence" },
  cover_provenance_guard: { agent: "Catalogue Curator", title: "Cover provenance" },
};

function percent(value: number | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "—";
}

export default function AgentReliabilityDashboard({ dashboard }: { dashboard: Dashboard }) {
  const router = useRouter();
  const [reviewer, setReviewer] = useStaffReviewer();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function run(command: "run_changed_suites" | "run_suite", evaluatorKey?: string) {
    if (!reviewer.trim()) {
      setMessage("Enter your staff name first.");
      return;
    }
    setBusy(evaluatorKey ?? "all");
    setMessage("");
    try {
      const response = await fetch("/api/agent-reliability", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command, evaluatorKey, reviewer: reviewer.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The reliability check failed.");
      setMessage("Reliability check complete. No agent rule was activated and nothing was published.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The reliability check failed.");
    } finally {
      setBusy("");
    }
  }

  if (!dashboard.ready) {
    return <section className="agent-reliability-panel"><div className="review-empty"><strong>Reliability database not ready.</strong><p>Apply the Agent Reliability migration, then return here.</p></div></section>;
  }

  return (
    <section className="agent-reliability-panel">
      <div className="agent-reliability-heading">
        <div><p className="eyebrow">Safety before autonomy</p><h2>Agent reliability</h2><p>Human decisions become permanent test cases. Checks replay stored evidence only—no eBay or catalogue API calls.</p></div>
        <div className="agent-reliability-runner">
          <label><span>Staff name</span><input onChange={(event) => setReviewer(event.target.value)} placeholder="e.g. SP" value={reviewer} /></label>
          <button disabled={Boolean(busy)} onClick={() => void run("run_changed_suites")} type="button">{busy === "all" ? "Checking…" : "Run reliability check"}</button>
        </div>
      </div>
      {message ? <p className="human-decision-banner" role="status">{message}</p> : null}
      <div className="agent-reliability-grid">
        {dashboard.suites.map((suite) => {
          const label = LABELS[suite.evaluatorKey] ?? { agent: suite.evaluatorKey, title: "Reliability suite" };
          const latest = suite.latest;
          const failedGates = latest ? Object.entries(latest.gates ?? {}).filter(([, gate]) => !gate.passed) : [];
          return <article className={!latest ? "is-unmeasured" : latest.passed ? "is-passing" : "is-learning"} key={suite.evaluatorKey}>
            <div className="agent-reliability-card-head"><span>{label.agent}</span><b>{!latest ? "Not measured" : latest.passed ? "Passing" : latest.regression_count ? "Needs attention" : "Learning"}</b></div>
            <h3>{label.title}</h3>
            <div className="agent-reliability-metrics">
              <p><strong>{latest?.case_count ?? 0}</strong><span>human cases</span></p>
              <p><strong>{percent(latest?.metrics?.balanced_accuracy)}</strong><span>balanced accuracy</span></p>
              <p><strong>{latest?.regression_count ?? 0}</strong><span>safety regressions</span></p>
            </div>
            {latest ? <details><summary>{failedGates.length ? `${failedGates.length} gate${failedGates.length === 1 ? "" : "s"} not ready` : "All gates passed"}</summary><ul>{Object.entries(latest.gates ?? {}).map(([name, gate]) => <li key={name}><span>{name.replaceAll("_", " ")}</span><b>{gate.passed ? "Pass" : `${gate.actual ?? 0} / ${gate.required ?? 0}`}</b></li>)}</ul></details> : <p>Run the check to build and test this benchmark set.</p>}
            {suite.failures?.length ? <details><summary>Inspect {suite.failures.length} failed example{suite.failures.length === 1 ? "" : "s"}</summary><ul>{suite.failures.slice(0, 8).map((failure, index) => <li key={`${failure.case?.subject_key ?? "case"}-${index}`}><span>{failure.case?.subject_key ?? "Benchmark case"}{failure.case?.reason_label ? ` · ${failure.case.reason_label.replaceAll("_", " ")}` : ""}</span><b>{failure.expected_outcome} → {failure.predicted_outcome}{failure.critical_failure ? " · safety" : ""}</b></li>)}</ul></details> : null}
            <button className="secondary" disabled={Boolean(busy)} onClick={() => void run("run_suite", suite.evaluatorKey)} type="button">{busy === suite.evaluatorKey ? "Checking…" : "Run this suite"}</button>
          </article>;
        })}
        <article className={dashboard.operator?.attention ? "is-learning" : "is-passing"}>
          <div className="agent-reliability-card-head"><span>RAR Operator</span><b>{dashboard.operator?.attention ? "Needs attention" : "Healthy"}</b></div>
          <h3>Operational runs</h3>
          <div className="agent-reliability-metrics">
            <p><strong>{dashboard.operator?.examined ?? 0}</strong><span>recent runs</span></p>
            <p><strong>{percent(dashboard.operator?.reliability ?? undefined)}</strong><span>completed cleanly</span></p>
            <p><strong>{dashboard.operator?.attention ?? 0}</strong><span>need attention</span></p>
          </div>
          <p>Operator health is measured as workflow reliability, not a classification score.</p>
        </article>
      </div>
      <p className="agent-reliability-safety">Passing means “safe enough to consider,” never “automatically publish.” Rule activation remains a separate human decision.</p>
    </section>
  );
}
