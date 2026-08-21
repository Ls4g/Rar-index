"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DISMISS_LEARNING_LABELS, WATCH_LEARNING_LABELS } from "@/lib/scoutDecisionLabels";

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
  evidence: Record<string, unknown> | null;
  proposed_payload: Record<string, unknown> | null;
  created_at: string;
};

type FeedbackExample = {
  leadId: string;
  listingTitle: string;
  editionLabel: string;
  score: number;
};

type HistoricalDecision = {
  decisionId: string;
  decision: "watching" | "dismissed";
  reviewer: string;
  decidedAt: string;
  listingTitle: string;
  editionLabel: string;
};

type RuleVersion = {
  id: string;
  rule_key: string;
  version: number;
  rule_type: string;
  status: string;
  evaluation_metrics: Record<string, unknown> | null;
  created_at: string;
  activated_at: string | null;
};

type RuleEvaluation = {
  id: string;
  rule_version_id: string;
  gates: Record<string, { passed?: boolean; actual?: number; required?: number }>;
  examples: Array<{ leadId: string; listingTitle: string; baselineScore: number; candidateScore: number }>;
  passed: boolean;
  evaluated_at: string;
};

type RuleDashboard = { rules: RuleVersion[]; evaluations: RuleEvaluation[]; ready: boolean };

type AgentCycle = {
  id: string;
  trigger_source: string;
  status: string;
  successful_agents: number;
  failed_agents: number;
  blocked_agents: number;
  summary: string | null;
  started_at: string;
  finished_at: string | null;
};

type AgentIncident = {
  id: string;
  incident_type: string;
  severity: string;
  status: string;
  title: string;
  details: Record<string, unknown> | null;
  created_at: string;
};

type AutopilotDashboard = {
  ready: boolean;
  control: {
    consecutive_failed_cycles: number;
    failure_threshold: number;
    auto_pause_on_failure: boolean;
    last_cycle_at: string | null;
    last_healthy_cycle_at: string | null;
    circuit_breaker_reason: string | null;
  } | null;
  cycles: AgentCycle[];
  incidents: AgentIncident[];
};

type EbayConnectionHealth = {
  status: "connected" | "missing" | "rejected" | "unavailable";
  configured: boolean;
  message: string;
  checkedAt: string;
};

const ACTION_LINKS: Record<string, { href: string; label: string }> = {
  stage_catalogue_candidates: { href: "/catalogue-review", label: "Review staged candidates" },
  review_catalogue_queue: { href: "/catalogue-review", label: "Open catalogue review" },
  research_catalogue_requests: { href: "/catalogue-requests", label: "Open requests" },
  source_missing_covers: { href: "/cover-review", label: "Open cover review" },
  triage_scout_leads: { href: "/scout", label: "Open Scout inbox" },
  scan_stale_profiles: { href: "/collection-profiles", label: "Open profiles" },
  tune_low_yield_profiles: { href: "/collection-profiles", label: "Tune search profiles" },
  review_sales_evidence: { href: "/review", label: "Open sale review" },
  classify_printing_evidence: { href: "/review", label: "Open print queue" },
  suggest_print_classification: { href: "/review", label: "Review prepared proof" },
  review_community_reports: { href: "/community-reports", label: "Open community reports" },
  resolve_readiness_bottleneck: { href: "/data-readiness", label: "Open readiness queue" },
  investigate_agent_failures: { href: "/agents#run-log", label: "Open run history" },
  review_scout_feedback_conflicts: { href: "/scout", label: "Inspect Scout examples" },
  review_scout_feedback_recall: { href: "/scout", label: "Inspect Scout examples" },
  review_scout_feedback_precision: { href: "/scout", label: "Inspect Scout examples" },
  shadow_test_first_print_proof_gate: { href: "/scout", label: "Inspect labelled examples" },
  shadow_test_multi_volume_detection: { href: "/scout", label: "Inspect labelled examples" },
  shadow_test_edition_conflicts: { href: "/scout", label: "Inspect labelled examples" },
  review_scout_rule_regression: { href: "/agents", label: "Inspect rule versions" },
  resolve_agent_incidents: { href: "/agents", label: "Open autopilot health" },
};

const FEEDBACK_ACTIONS = new Set([
  "review_scout_feedback_conflicts",
  "review_scout_feedback_recall",
  "review_scout_feedback_precision",
  "shadow_test_first_print_proof_gate",
  "shadow_test_multi_volume_detection",
  "shadow_test_edition_conflicts",
  "review_scout_rule_regression",
]);

function isFeedbackAction(action: Action) {
  return FEEDBACK_ACTIONS.has(action.action_type);
}

function feedbackExamples(action: Action): FeedbackExample[] {
  const examples = action.evidence?.examples;
  return Array.isArray(examples) ? examples as FeedbackExample[] : [];
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function modeLabel(control: Control) {
  if (control.mode === "safe_actions") return "Safe cleanup";
  if (control.mode === "prepare" && control.agent_key === "catalogue_curator") return "Prepares candidates";
  if (control.mode === "prepare") return "Prepares evidence";
  return "Advises only";
}

function runButtonLabel(control: Control, isBusy: boolean) {
  if (isBusy) return "Running...";
  if (control.agent_key === "catalogue_curator" && control.mode === "prepare") return "Discover candidates";
  if (control.mode === "safe_actions") return "Run safe cleanup";
  if (control.mode === "prepare") return "Prepare evidence";
  return "Run report";
}

function statusLabel(status?: string) {
  if (status === "succeeded") return "Healthy";
  if (status === "degraded") return "Degraded";
  if (status === "failed") return "Needs attention";
  if (status === "running") return "Running";
  if (status === "blocked") return "Blocked";
  return "Not run yet";
}

function metricLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function AgentControlCentre({
  controls,
  runs,
  actions,
  globalPaused,
  pauseReason,
  historicalDecisions,
  historicalDecisionTotal,
  ruleDashboard,
  autopilot,
  ebayHealth: initialEbayHealth,
}: {
  controls: Control[];
  runs: Run[];
  actions: Action[];
  globalPaused: boolean;
  pauseReason: string | null;
  historicalDecisions: HistoricalDecision[];
  historicalDecisionTotal: number;
  ruleDashboard: RuleDashboard;
  autopilot: AutopilotDashboard;
  ebayHealth: EbayConnectionHealth;
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [selectedHistorical, setSelectedHistorical] = useState<string[]>([]);
  const [labelledThisSession, setLabelledThisSession] = useState<string[]>([]);
  const [historicalDecisionType, setHistoricalDecisionType] = useState<"watching" | "dismissed" | "">("");
  const [historicalLabel, setHistoricalLabel] = useState("");
  const [rulePhrases, setRulePhrases] = useState<Record<string, string>>({});
  const [ebayHealth, setEbayHealth] = useState(initialEbayHealth);

  useEffect(() => {
    const timer = window.setTimeout(() => setReviewer(window.localStorage.getItem("rar_staff_reviewer") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function updateReviewer(value: string) {
    setReviewer(value);
    window.localStorage.setItem("rar_staff_reviewer", value);
  }

  async function testEbayConnection() {
    if (!reviewer.trim()) {
      setMessage("Enter your staff name first.");
      return;
    }
    setBusy("ebay-health");
    setMessage("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: "test_ebay_connection", reviewer: reviewer.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The eBay connection test failed.");
      setEbayHealth(result.health as EbayConnectionHealth);
      setMessage(result.health.message);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The eBay connection test failed.");
    } finally {
      setBusy("");
    }
  }

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
      setMessage("Agents updated.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The command failed.");
    } finally {
      setBusy("");
    }
  }

  function toggleHistorical(decisionId: string, decision: "watching" | "dismissed") {
    if (historicalDecisionType && historicalDecisionType !== decision) {
      setSelectedHistorical([decisionId]);
      setHistoricalDecisionType(decision);
      setHistoricalLabel("");
      return;
    }
    const selected = selectedHistorical.includes(decisionId)
      ? selectedHistorical.filter((id) => id !== decisionId)
      : [...selectedHistorical, decisionId];
    setSelectedHistorical(selected);
    setHistoricalDecisionType(selected.length ? decision : "");
    if (!selected.length) setHistoricalLabel("");
  }

  async function labelHistorical() {
    if (!reviewer.trim() || !selectedHistorical.length || !historicalLabel) {
      setMessage("Choose matching decisions, a reason and your staff name.");
      return;
    }
    setBusy("historical-labels");
    setMessage("");
    try {
      const response = await fetch("/api/scout-labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisionIds: selectedHistorical, label: historicalLabel, reviewer: reviewer.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The labels could not be saved.");
      const savedIds = Array.isArray(result.results)
        ? result.results.filter((item: { ok?: boolean }) => item.ok).map((item: { decisionId: string }) => item.decisionId)
        : selectedHistorical;
      const failedIds = selectedHistorical.filter((decisionId) => !savedIds.includes(decisionId));
      setLabelledThisSession((current) => [...new Set([...current, ...savedIds])]);
      setMessage(`${result.saved} historical decision${result.saved === 1 ? "" : "s"} labelled and removed.${result.failed ? ` ${result.failed} could not be saved.` : ""}`);
      setSelectedHistorical(failedIds);
      setHistoricalDecisionType(failedIds.length ? historicalDecisions.find((item) => item.decisionId === failedIds[0])?.decision ?? "" : "");
      setHistoricalLabel("");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The labels could not be saved.");
    } finally {
      setBusy("");
    }
  }

  const lastRun = new Map<string, Run>();
  for (const run of runs) if (!lastRun.has(run.agent_key)) lastRun.set(run.agent_key, run);
  const proposed = actions.filter((action) => action.status === "proposed");
  const plannedFeedback = actions.filter((action) => action.status === "approved" && isFeedbackAction(action));
  const executed = actions.filter((action) => action.status === "executed").slice(0, 10);
  const operatorBriefing = runs.find((run) => run.agent_key === "rar_operator");
  const marketScoutRun = runs.find((run) => run.agent_key === "market_scout");
  const evidenceRun = runs.find((run) => run.agent_key === "evidence_auditor");
  const scoutReviewCount = marketScoutRun?.metrics?.scout_review_now ?? 0;
  const evidenceReviewCount = (evidenceRun?.metrics?.sales_needing_review ?? 0)
    + (evidenceRun?.metrics?.printing_suggestions_open ?? 0)
    + (evidenceRun?.metrics?.community_reports_pending ?? 0);
  const feedbackDecisions = marketScoutRun?.metrics?.feedback_human_decisions ?? 0;
  const feedbackAligned = marketScoutRun?.metrics?.feedback_aligned ?? 0;
  const feedbackLabelled = marketScoutRun?.metrics?.feedback_labelled_decisions ?? 0;
  const feedbackExceptions = (marketScoutRun?.metrics?.feedback_watched_below_review ?? 0)
    + (marketScoutRun?.metrics?.feedback_watched_conflicts ?? 0)
    + (marketScoutRun?.metrics?.feedback_dismissed_still_plausible ?? 0);
  const visibleHistoricalDecisions = historicalDecisions.filter((decision) => !labelledThisSession.includes(decision.decisionId));
  const remainingHistoricalTotal = Math.max(0, historicalDecisionTotal - labelledThisSession.length);
  const latestCycle = autopilot.cycles[0];
  const autopilotTitle = globalPaused && autopilot.control?.circuit_breaker_reason
    ? "Circuit breaker paused automation"
    : latestCycle?.status === "succeeded"
      ? "Daily agent cycle is healthy"
      : latestCycle
        ? "The latest cycle needs attention"
        : "Ready for the first guarded cycle";

  return (
    <div className="agent-control-content">
      <section className="agent-workbench">
        <div className="agent-workbench-heading">
          <div><p className="eyebrow">Today</p><h2>What needs you</h2><p>{operatorBriefing?.summary ?? "Run RAR Operator when you want a fresh summary of the system."}</p></div>
          <Link href="/data-readiness">View all data gaps →</Link>
        </div>
        <div className="agent-workbench-grid">
          <Link href="#agent-recommendations"><strong>{proposed.length}</strong><span>agent recommendations</span><small>Review suggested work</small></Link>
          <Link href="/scout"><strong>{scoutReviewCount}</strong><span>Scout leads for people</span><small>Open the filtered inbox</small></Link>
          <Link href="/review"><strong>{evidenceReviewCount}</strong><span>evidence decisions</span><small>Review sales and printing proof</small></Link>
        </div>
      </section>

      <section className={`agent-autopilot-panel ${globalPaused ? "is-paused" : ""}`}>
        <div className="agent-autopilot-heading">
          <div><p className="eyebrow">Phase 5 autopilot</p><h2>{autopilotTitle}</h2><p>{latestCycle?.summary ?? "RAR will run all four assistants as one recorded cycle and stop itself after repeated technical failures."}</p></div>
          <button disabled={Boolean(busy) || globalPaused || !autopilot.ready} onClick={() => command("guarded-cycle", { command: "run_guarded_cycle" })} type="button">{busy === "guarded-cycle" ? "Running cycle..." : "Run guarded cycle"}</button>
        </div>
        {autopilot.ready ? <div className="agent-autopilot-metrics">
          <span><b>{latestCycle ? statusLabel(latestCycle.status) : "Ready"}</b>latest cycle</span>
          <span><b>{latestCycle?.successful_agents ?? 0}/4</b>agents completed</span>
          <span><b>{autopilot.control?.consecutive_failed_cycles ?? 0}/{autopilot.control?.failure_threshold ?? 2}</b>failures before stop</span>
          <span><b>{autopilot.incidents.length}</b>open incidents</span>
        </div> : <div className="review-empty agent-empty-compact"><strong>Phase 5 database is not ready.</strong><p>Apply the guarded-autopilot migration before running a full cycle.</p></div>}
        {autopilot.incidents.length ? <div className="agent-incident-list">{autopilot.incidents.map((incident) => <article className={`is-${incident.severity}`} key={incident.id}>
          <div><span>{incident.severity} · {incident.incident_type.replaceAll("_", " ")}</span><strong>{incident.title}</strong><small>{formatTime(incident.created_at)}</small></div>
          <button className="secondary" disabled={Boolean(busy)} onClick={() => command(`incident-${incident.id}`, { command: "resolve_agent_incident", incidentId: incident.id })} type="button">Resolve</button>
        </article>)}</div> : null}
        {autopilot.cycles.length ? <details className="agent-cycle-history"><summary>Recent guarded cycles</summary><div>{autopilot.cycles.slice(0, 10).map((cycle) => <article key={cycle.id}><span className={`agent-run-status ${cycle.status}`}>{statusLabel(cycle.status)}</span><strong>{cycle.summary ?? "Cycle completed"}</strong><small>{formatTime(cycle.started_at)} · {cycle.trigger_source}</small></article>)}</div></details> : null}
      </section>

      <section className={`agent-kill-switch ${globalPaused ? "is-paused" : ""}`}>
        <div>
          <span className="agent-status-light" />
          <p className="eyebrow">Safety</p>
          <h2>{globalPaused ? "All agents are paused" : "Safe automation is active"}</h2>
          <p>{globalPaused ? pauseReason ?? "Scheduled and manual agent runs are stopped." : "Agents can organise work and perform approved safe cleanup. Only staff can verify sales, classify printings, or publish catalogue records."}</p>
        </div>
        <button className={globalPaused ? "agent-control-button" : "agent-danger-button"} disabled={busy === "global"} onClick={() => command("global", { command: "set_global_paused", paused: !globalPaused })} type="button">
          {busy === "global" ? "Updating..." : globalPaused ? "Resume agents" : "Pause agents"}
        </button>
      </section>

      <section className="agent-identity-bar">
        <label><span>Staff name</span><input onChange={(event) => updateReviewer(event.target.value)} placeholder="e.g. SP" value={reviewer} /></label>
        <p>{message || "Saved on this device and attached to every manual agent action."}</p>
      </section>

      <section className={`agent-integration-health is-${ebayHealth.status}`}>
        <div>
          <span className="agent-integration-light" />
          <p className="eyebrow">Marketplace connection</p>
          <h2>eBay {ebayHealth.status === "connected" ? "connected" : "needs attention"}</h2>
          <p>{ebayHealth.message}</p>
          <small>Checked {formatTime(ebayHealth.checkedAt)}. If unavailable, Market Scout continues its database cleanup and leaves eBay-dependent availability checks untouched.</small>
        </div>
        <button className="agent-control-button" disabled={Boolean(busy)} onClick={testEbayConnection} type="button">
          {busy === "ebay-health" ? "Testing..." : "Test eBay connection"}
        </button>
      </section>

      <section className="agent-feedback-panel">
        <div className="agent-feedback-copy">
          <p className="eyebrow">Controlled learning</p>
          <h2>Staff decisions improve the rules safely</h2>
          <p>Market Scout compares human Watch and Dismiss decisions with its current score. Optional reason labels teach it why, while every experiment stays in shadow mode until a tested rule is separately approved.</p>
        </div>
        <div className="agent-feedback-metrics">
          <span><b>{feedbackDecisions}</b>human decisions analysed</span>
          <span><b>{feedbackAligned}</b>agree with current rules</span>
          <span><b>{feedbackLabelled}</b>include a reason label</span>
          <span><b>{feedbackExceptions}</b>exceptions to inspect</span>
        </div>
        {plannedFeedback.length ? <div className="agent-feedback-planned"><strong>Approved investigations</strong>{plannedFeedback.map((action) => <span key={action.id}>{action.title}</span>)}</div> : null}
      </section>

      <section className="agent-learning-workbench">
        <div className="section-intro"><p className="eyebrow">Phase 4 evidence</p><h2>Label earlier decisions</h2><p className="section-copy">Add a reason without reopening or changing the original Watch or Dismiss decision. Selecting the other decision type starts a new batch.</p></div>
        <div className="agent-label-toolbar">
          <strong>{remainingHistoricalTotal} unlabelled total · {visibleHistoricalDecisions.length} loaded here</strong>
          <select disabled={!selectedHistorical.length} onChange={(event) => setHistoricalLabel(event.target.value)} value={historicalLabel}>
            <option value="">Choose a reason</option>
            {(historicalDecisionType === "watching" ? WATCH_LEARNING_LABELS : DISMISS_LEARNING_LABELS).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button disabled={busy === "historical-labels" || !selectedHistorical.length || !historicalLabel} onClick={labelHistorical} type="button">{busy === "historical-labels" ? "Saving..." : `Label selected (${selectedHistorical.length})`}</button>
        </div>
        {visibleHistoricalDecisions.length ? <div className="agent-label-list">{visibleHistoricalDecisions.map((decision) => <label className={selectedHistorical.includes(decision.decisionId) ? "is-selected" : ""} key={decision.decisionId}>
          <input checked={selectedHistorical.includes(decision.decisionId)} onChange={() => toggleHistorical(decision.decisionId, decision.decision)} type="checkbox" />
          <span><b>{decision.decision === "watching" ? "Watched" : "Dismissed"} · {decision.editionLabel}</b><small>{decision.listingTitle}</small><em>{decision.reviewer} · {formatTime(decision.decidedAt)}</em></span>
        </label>)}</div> : remainingHistoricalTotal ? <div className="review-empty agent-empty-compact"><strong>This batch is finished.</strong><p>{remainingHistoricalTotal} earlier decisions remain in the backlog.</p></div> : <div className="review-empty agent-empty-compact"><strong>Historical decisions are labelled.</strong><p>New reason labels will continue to arrive through the Scout inbox.</p></div>}
        {labelledThisSession.length > 0 && remainingHistoricalTotal > 0 ? <button className="agent-load-next" onClick={() => window.location.reload()} type="button">Load the next decisions</button> : null}
      </section>

      <section className="agent-rule-workbench">
        <div className="section-intro"><p className="eyebrow">Scoring rules</p><h2>Shadow tests and active versions</h2><p className="section-copy">A passing test still needs a separate activation. Learned rules only adjust queue scores and can never verify or dismiss a listing.</p></div>
        {!ruleDashboard.ready ? <div className="review-empty agent-empty-compact"><strong>Phase 4 database is not ready.</strong><p>Apply the 20260826 Phase 4 migration to begin storing evaluations and rule versions.</p></div> : ruleDashboard.rules.length ? <div className="agent-rule-list">{ruleDashboard.rules.map((rule) => {
          const evaluation = ruleDashboard.evaluations.find((item) => item.rule_version_id === rule.id);
          return <article className={`is-${rule.status}`} key={rule.id}>
            <div><span>{rule.rule_type.replaceAll("_", " ")} · version {rule.version}</span><h3>{rule.rule_key}</h3><b>{rule.status.replaceAll("_", " ")}</b>{evaluation ? <p>{evaluation.passed ? "All promotion gates passed." : "More or better labelled evidence is required."}</p> : <p>Not evaluated yet.</p>}</div>
            {evaluation ? <details><summary>Evaluation gates</summary><ul>{Object.entries(evaluation.gates).map(([name, gate]) => <li key={name} className={gate.passed ? "passed" : "failed"}><span>{name.replaceAll("_", " ")}</span><b>{gate.passed ? "Pass" : "Not ready"}</b><small>{String(gate.actual ?? 0)} / {String(gate.required ?? 0)}</small></li>)}</ul></details> : null}
            <div className="agent-card-actions">
              {rule.status === "candidate" ? <button disabled={Boolean(busy)} onClick={() => command(`reevaluate-${rule.id}`, { command: "reevaluate_scout_rule", ruleVersionId: rule.id })} type="button">Run shadow test again</button> : null}
              {rule.status === "shadow_passed" ? <button disabled={Boolean(busy)} onClick={() => command(`activate-${rule.id}`, { command: "activate_scout_rule", ruleVersionId: rule.id })} type="button">Approve activation</button> : null}
              {rule.status === "superseded" ? <button className="secondary" disabled={Boolean(busy)} onClick={() => command(`rollback-${rule.id}`, { command: "rollback_scout_rule", ruleVersionId: rule.id })} type="button">Restore this version</button> : null}
            </div>
          </article>;
        })}</div> : <div className="review-empty agent-empty-compact"><strong>No rule versions yet.</strong><p>Run Market Scout, then approve one of its shadow-test recommendations.</p></div>}
      </section>

      <section className="agent-proposals" id="agent-recommendations">
        <div className="section-intro"><p className="eyebrow">Your decision</p><h2>Recommended work</h2><p className="section-copy">Open the relevant queue when the suggestion is useful. Approving a plan never verifies or publishes data.</p></div>
        {proposed.length ? <div className="agent-proposal-list">{proposed.map((action) => {
          const workQueue = ACTION_LINKS[action.action_type];
          const examples = feedbackExamples(action);
          const needsPhrases = ["shadow_test_multi_volume_detection", "shadow_test_edition_conflicts"].includes(action.action_type);
          return <article className={isFeedbackAction(action) ? "is-feedback" : ""} key={action.id}><div><span>{action.agent_key.replaceAll("_", " ")} · {action.confidence == null ? "unscored" : `${Math.round(action.confidence * 100)}% confidence`}</span><h3>{action.title}</h3><p>{action.rationale}</p>{examples.length ? <details className="agent-feedback-examples"><summary>View {examples.length} example{examples.length === 1 ? "" : "s"}</summary><ul>{examples.map((example) => <li key={example.leadId}><strong>{example.editionLabel}</strong><span>{example.listingTitle}</span><small>Current score: {example.score}/100</small></li>)}</ul></details> : null}{needsPhrases ? <label className="agent-rule-phrases"><span>Exact phrases to shadow-test</span><input onChange={(event) => setRulePhrases((current) => ({ ...current, [action.id]: event.target.value }))} placeholder={action.action_type === "shadow_test_multi_volume_detection" ? "bundle, complete set, volumes" : "deluxe edition, omnibus"} value={rulePhrases[action.id] ?? ""} /></label> : null}<small>{formatTime(action.created_at)}</small></div><div>{workQueue ? <Link className="agent-queue-link" href={workQueue.href}>{workQueue.label} →</Link> : null}<button disabled={Boolean(busy)} onClick={() => command(`approve-${action.id}`, { command: "review_action", actionId: action.id, decision: "approved", rulePhrases: rulePhrases[action.id] ?? "" })} type="button">{isFeedbackAction(action) ? "Approve investigation" : "Mark planned"}</button><button className="secondary" disabled={Boolean(busy)} onClick={() => command(`reject-${action.id}`, { command: "review_action", actionId: action.id, decision: "rejected" })} type="button">Dismiss</button></div></article>;
        })}</div> : <div className="review-empty agent-empty-compact"><strong>Nothing is waiting for approval.</strong><p>The agents have no new recommendations for you.</p></div>}
      </section>

      <section className="agent-team-section">
        <div className="section-intro"><p className="eyebrow">Automation team</p><h2>Your four assistants</h2><p className="section-copy">Run an assistant manually when you want fresh work. Their detailed measurements stay folded away by default.</p></div>
        <div className="agent-card-grid">
          {controls.map((control) => {
            const run = lastRun.get(control.agent_key);
            return (
              <article className={`agent-card ${control.is_paused ? "is-paused" : ""}`} key={control.agent_key}>
                <div className="agent-card-heading"><div><span>{modeLabel(control)}</span><h2>{control.display_name}</h2></div><b>{control.is_paused ? "Paused" : statusLabel(run?.status)}</b></div>
                <p>{control.mission}</p>
                <div className="agent-last-run">
                  <small>Latest report</small>
                  <strong>{run?.summary ?? "This assistant has not run yet."}</strong>
                  {run ? <span>{formatTime(run.started_at)} · {run.trigger_source}</span> : null}
                  {run?.error_message ? <em>{run.error_message}</em> : null}
                </div>
                {run?.metrics ? <details className="agent-run-details"><summary>Technical details</summary><div className="agent-metrics">{Object.entries(run.metrics).map(([label, value]) => <span key={label}><b>{value}</b>{metricLabel(label)}</span>)}</div></details> : null}
                <div className="agent-card-actions">
                  <button disabled={Boolean(busy) || globalPaused || control.is_paused} onClick={() => command(`run-${control.agent_key}`, { command: "run_agent", agentKey: control.agent_key })} type="button">{runButtonLabel(control, busy === `run-${control.agent_key}`)}</button>
                  <button className="secondary" disabled={Boolean(busy)} onClick={() => command(`pause-${control.agent_key}`, { command: "set_agent_paused", agentKey: control.agent_key, paused: !control.is_paused })} type="button">{control.is_paused ? "Resume" : "Pause"}</button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <details className="agent-history-panel">
        <summary><span><small>Background activity</small><strong>Recently completed safe work</strong></span><b>{executed.length}</b></summary>
        <div className="agent-history-content">{executed.length ? <div className="agent-executed-list">{executed.map((action) => {
          const destination = ACTION_LINKS[action.action_type] ?? { href: "/agents#run-log", label: "Inspect audit" };
          return <article key={action.id}><div><span>Completed · {formatTime(action.created_at)}</span><strong>{action.title}</strong><p>{action.rationale}</p></div><Link href={destination.href}>{destination.label} →</Link></article>;
        })}</div> : <div className="review-empty agent-empty-compact"><strong>No recent safe actions.</strong></div>}</div>
      </details>

      <details className="agent-history-panel" id="run-log">
        <summary><span><small>Technical audit</small><strong>Agent run history</strong></span><b>{Math.min(runs.length, 30)}</b></summary>
        <div className="agent-history-content"><div className="readiness-table-wrap"><table><thead><tr><th>Agent</th><th>Status</th><th>Started</th><th>Trigger</th><th>Report</th></tr></thead><tbody>{runs.slice(0, 30).map((run) => <tr key={run.id}><td>{run.agent_key.replaceAll("_", " ")}</td><td><span className={`agent-run-status ${run.status}`}>{statusLabel(run.status)}</span></td><td>{formatTime(run.started_at)}</td><td>{run.trigger_source}</td><td>{run.summary ?? run.error_message ?? "Run in progress"}</td></tr>)}</tbody></table></div></div>
      </details>
    </div>
  );
}
