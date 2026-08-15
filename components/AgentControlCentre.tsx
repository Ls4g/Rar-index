"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Control = {
  agent_key: string;
  display_name: string;
  mission: string;
  mode: string;
  is_paused: boolean;
  schedule_label: string | null;
};
type Run = {
  id: string;
  agent_key: string;
  status: string;
  trigger_source: string;
  summary: string | null;
  metrics: Record<string, number> | null;
  error_message: string | null;
  started_at: string;
};
type Action = {
  id: string;
  agent_key: string;
  action_type: string;
  title: string;
  rationale: string;
  confidence: number | null;
  status: string;
  created_at: string;
};

const ACTION_LINKS: Record<string, { href: string; label: string }> = {
  review_catalogue_queue: { href: "/catalogue-review", label: "Open catalogue review" },
  research_catalogue_requests: { href: "/catalogue-requests", label: "Open requests" },
  source_missing_covers: { href: "/cover-review", label: "Open cover review" },
  triage_scout_leads: { href: "/scout", label: "Open Scout inbox" },
  scan_stale_profiles: { href: "/collection-profiles", label: "Open profiles" },
  review_sales_evidence: { href: "/review", label: "Open sale review" },
  classify_printing_evidence: { href: "/review", label: "Open print queue" },
  review_community_reports: { href: "/community-reports", label: "Open community reports" },
  resolve_readiness_bottleneck: { href: "/data-readiness", label: "Open readiness queue" },
  investigate_agent_failures: { href: "/agents#run-log", label: "Open run log" },
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function AgentControlCentre({
  controls,
  runs,
  actions,
  globalPaused,
  pauseReason,
}: {
  controls: Control[];
  runs: Run[];
  actions: Action[];
  globalPaused: boolean;
  pauseReason: string | null;
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function command(key: string, body: Record<string, unknown>) {
    if (!reviewer.trim()) {
      setMessage("Enter your staff name first.");
      return;
    }
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...body, reviewer: reviewer.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The command failed.");
      setMessage("Control centre updated.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The command failed.");
    } finally {
      setBusy("");
    }
  }

  const lastRun = new Map<string, Run>();
  for (const run of runs) if (!lastRun.has(run.agent_key)) lastRun.set(run.agent_key, run);
  const proposed = actions.filter((action) => action.status === "proposed");
  const executed = actions.filter((action) => action.status === "executed").slice(0, 10);
  const operatorBriefing = runs.find((run) => run.agent_key === "rar_operator");

  return (
    <div className="agent-control-content">
      <section className={`agent-kill-switch ${globalPaused ? "is-paused" : ""}`}>
        <div>
          <span className="agent-status-light" />
          <p className="eyebrow">Global safety control</p>
          <h2>{globalPaused ? "All RAR agents are paused" : "Phase 2 safety system active"}</h2>
          <p>{globalPaused ? pauseReason ?? "No scheduled or manual agent runs can proceed." : "Market Scout may dismiss explicit listing conflicts. Plausible leads, sale verification and catalogue publication remain human-controlled."}</p>
        </div>
        <button className={globalPaused ? "staff-action-link agent-control-button" : "agent-danger-button"} disabled={busy === "global"} onClick={() => command("global", { command: "set_global_paused", paused: !globalPaused })} type="button">
          {busy === "global" ? "Updating..." : globalPaused ? "Resume all agents" : "Pause all agents"}
        </button>
      </section>

      <section className="agent-identity-bar">
        <label><span>Staff name</span><input onChange={(event) => setReviewer(event.target.value)} placeholder="e.g. SP" value={reviewer} /></label>
        <p>{message || "Your name is recorded against manual runs and proposal decisions."}</p>
      </section>

      <section className="agent-card-grid">
        {controls.map((control) => {
          const run = lastRun.get(control.agent_key);
          return (
            <article className={`agent-card ${control.is_paused ? "is-paused" : ""}`} key={control.agent_key}>
              <div className="agent-card-heading"><div><span>{control.mode}</span><h2>{control.display_name}</h2></div><b>{control.is_paused ? "Paused" : run?.status ?? "Never run"}</b></div>
              <p>{control.mission}</p>
              <div className="agent-last-run">
                <small>Latest run</small>
                <strong>{run?.summary ?? "Run this agent to create its first operational report."}</strong>
                {run ? <span>{formatTime(run.started_at)} · {run.trigger_source}</span> : null}
                {run?.error_message ? <em>{run.error_message}</em> : null}
              </div>
              {run?.metrics ? <div className="agent-metrics">{Object.entries(run.metrics).slice(0, 8).map(([label, value]) => <span key={label}><b>{value}</b>{label.replaceAll("_", " ")}</span>)}</div> : null}
              <div className="agent-card-actions">
                <button disabled={Boolean(busy) || globalPaused || control.is_paused} onClick={() => command(`run-${control.agent_key}`, { command: "run_agent", agentKey: control.agent_key })} type="button">{busy === `run-${control.agent_key}` ? "Running..." : control.mode === "safe_actions" ? "Run safe triage" : "Run observation"}</button>
                <button className="secondary" disabled={Boolean(busy)} onClick={() => command(`pause-${control.agent_key}`, { command: "set_agent_paused", agentKey: control.agent_key, paused: !control.is_paused })} type="button">{control.is_paused ? "Resume" : "Pause"}</button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="agent-daily-briefing">
        <div><p className="eyebrow">Daily operator briefing</p><h2>{operatorBriefing?.summary ?? "Run RAR Operator to create today’s briefing."}</h2><p>The briefing reports what agents actually did, what still requires a person, and the largest remaining data bottleneck.</p></div>
        {operatorBriefing?.metrics ? <div className="agent-briefing-metrics">
          <span><b>{operatorBriefing.metrics.safe_agent_actions_24h ?? 0}</b>safe actions in 24h</span>
          <span><b>{operatorBriefing.metrics.scout_auto_dismissals_24h ?? 0}</b>Scout conflicts removed</span>
          <span><b>{operatorBriefing.metrics.open_agent_proposals ?? 0}</b>open recommendations</span>
          <span><b>{operatorBriefing.metrics.failed_agent_runs_24h ?? 0}</b>failed runs</span>
        </div> : null}
      </section>

      <section className="agent-proposals">
        <div className="section-intro"><p className="eyebrow">Agent recommendations</p><h2>Proposed work, never silent execution</h2><p className="section-copy">Recommendations link directly to the correct staff queue. Approval records the plan; it never verifies a sale or publishes a record.</p></div>
        {proposed.length ? <div className="agent-proposal-list">{proposed.map((action) => {
          const workQueue = ACTION_LINKS[action.action_type];
          return <article key={action.id}><div><span>{action.agent_key.replaceAll("_", " ")} · {action.confidence == null ? "unscored" : `${Math.round(action.confidence * 100)}% confidence`}</span><h3>{action.title}</h3><p>{action.rationale}</p><small>{formatTime(action.created_at)}</small></div><div>{workQueue ? <Link className="agent-queue-link" href={workQueue.href}>{workQueue.label} →</Link> : null}<button disabled={Boolean(busy)} onClick={() => command(`approve-${action.id}`, { command: "review_action", actionId: action.id, decision: "approved" })} type="button">Approve for planning</button><button className="secondary" disabled={Boolean(busy)} onClick={() => command(`reject-${action.id}`, { command: "review_action", actionId: action.id, decision: "rejected" })} type="button">Dismiss</button></div></article>;
        })}</div> : <div className="review-empty"><strong>No open agent recommendations.</strong><p>Run one or more agents to assess the current workload.</p></div>}
      </section>

      <section className="agent-safe-action-log">
        <div className="section-intro"><p className="eyebrow">Safe autonomous work</p><h2>Recently executed actions</h2><p className="section-copy">Only definitive lead dismissals can appear here in Phase 2. Every underlying listing also receives a normal Scout audit record.</p></div>
        {executed.length ? <div className="agent-executed-list">{executed.map((action) => <article key={action.id}><div><span>Executed · {formatTime(action.created_at)}</span><strong>{action.title}</strong><p>{action.rationale}</p></div><Link href="/scout?includeDismissed=1">Inspect Scout archive →</Link></article>)}</div> : <div className="review-empty"><strong>No safe actions executed yet.</strong><p>The next Market Scout run will examine untouched leads for explicit conflicts.</p></div>}
      </section>

      <section className="agent-run-log" id="run-log">
        <div className="section-intro"><p className="eyebrow">Audit trail</p><h2>Recent agent runs</h2></div>
        <div className="readiness-table-wrap"><table><thead><tr><th>Agent</th><th>Status</th><th>Started</th><th>Trigger</th><th>Report</th></tr></thead><tbody>{runs.slice(0, 30).map((run) => <tr key={run.id}><td>{run.agent_key.replaceAll("_", " ")}</td><td><span className={`agent-run-status ${run.status}`}>{run.status}</span></td><td>{formatTime(run.started_at)}</td><td>{run.trigger_source}</td><td>{run.summary ?? run.error_message ?? "Run in progress"}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}
