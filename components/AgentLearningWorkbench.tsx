"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DISMISS_LEARNING_LABELS, WATCH_LEARNING_LABELS } from "@/lib/scoutDecisionLabels";

export type HistoricalScoutDecision = {
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
};

type RuleEvaluation = {
  id: string;
  rule_version_id: string;
  gates: Record<string, { passed?: boolean; actual?: number; required?: number }>;
  passed: boolean;
};

export type ScoutRuleDashboard = {
  rules: RuleVersion[];
  evaluations: RuleEvaluation[];
  ready: boolean;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function AgentLearningWorkbench({
  historicalDecisions,
  historicalDecisionTotal,
  ruleDashboard,
}: {
  historicalDecisions: HistoricalScoutDecision[];
  historicalDecisionTotal: number;
  ruleDashboard: ScoutRuleDashboard;
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [labelledThisSession, setLabelledThisSession] = useState<string[]>([]);
  const [decisionType, setDecisionType] = useState<"watching" | "dismissed" | "">("");
  const [label, setLabel] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setReviewer(window.localStorage.getItem("rar_staff_reviewer") ?? ""), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function updateReviewer(value: string) {
    setReviewer(value);
    window.localStorage.setItem("rar_staff_reviewer", value);
  }

  function toggleDecision(decisionId: string, decision: "watching" | "dismissed") {
    if (decisionType && decisionType !== decision) {
      setSelected([decisionId]);
      setDecisionType(decision);
      setLabel("");
      return;
    }
    const next = selected.includes(decisionId) ? selected.filter((id) => id !== decisionId) : [...selected, decisionId];
    setSelected(next);
    setDecisionType(next.length ? decision : "");
    if (!next.length) setLabel("");
  }

  async function labelHistorical() {
    if (!reviewer.trim() || !selected.length || !label) {
      setMessage("Choose matching decisions, a reason and your staff name.");
      return;
    }
    setBusy("historical-labels");
    setMessage("");
    try {
      const response = await fetch("/api/scout-labels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisionIds: selected, label, reviewer: reviewer.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The labels could not be saved.");
      const savedIds = Array.isArray(result.results)
        ? result.results.filter((item: { ok?: boolean }) => item.ok).map((item: { decisionId: string }) => item.decisionId)
        : selected;
      const failedIds = selected.filter((decisionId) => !savedIds.includes(decisionId));
      setLabelledThisSession((current) => [...new Set([...current, ...savedIds])]);
      setSelected(failedIds);
      setDecisionType(failedIds.length ? historicalDecisions.find((item) => item.decisionId === failedIds[0])?.decision ?? "" : "");
      setLabel("");
      setMessage(`${result.saved} decision${result.saved === 1 ? "" : "s"} labelled and removed.${result.failed ? ` ${result.failed} could not be saved.` : ""}`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The labels could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function runRuleCommand(key: string, command: string, ruleVersionId: string) {
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
        body: JSON.stringify({ command, ruleVersionId, reviewer: reviewer.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The rule action failed.");
      setMessage("Learning rule updated.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "The rule action failed.");
    } finally {
      setBusy("");
    }
  }

  const visibleDecisions = historicalDecisions.filter((decision) => !labelledThisSession.includes(decision.decisionId));
  const remainingTotal = Math.max(0, historicalDecisionTotal - labelledThisSession.length);

  return (
    <div className="agent-control-content">
      <section className="agent-identity-bar">
        <label><span>Staff name</span><input onChange={(event) => updateReviewer(event.target.value)} placeholder="e.g. SP" value={reviewer} /></label>
        <p>{message || "Saved on this device and attached to every learning decision."}</p>
      </section>

      <section className="agent-learning-workbench">
        <div className="section-intro"><p className="eyebrow">Decision labels</p><h2>Teach Scout why</h2><p className="section-copy">Add a reason to earlier Watch or Dismiss decisions. This never changes the original decision; it only creates labelled feedback for safer rule tests.</p></div>
        <div className="agent-label-toolbar">
          <strong>{remainingTotal} unlabelled total · {visibleDecisions.length} loaded here</strong>
          <select disabled={!selected.length} onChange={(event) => setLabel(event.target.value)} value={label}>
            <option value="">Choose a reason</option>
            {(decisionType === "watching" ? WATCH_LEARNING_LABELS : DISMISS_LEARNING_LABELS).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <button disabled={busy === "historical-labels" || !selected.length || !label} onClick={labelHistorical} type="button">{busy === "historical-labels" ? "Saving..." : `Label selected (${selected.length})`}</button>
        </div>
        {visibleDecisions.length ? <div className="agent-label-list">{visibleDecisions.map((decision) => <label className={selected.includes(decision.decisionId) ? "is-selected" : ""} key={decision.decisionId}>
          <input checked={selected.includes(decision.decisionId)} onChange={() => toggleDecision(decision.decisionId, decision.decision)} type="checkbox" />
          <span><b>{decision.decision === "watching" ? "Watched" : "Dismissed"} · {decision.editionLabel}</b><small>{decision.listingTitle}</small><em>{decision.reviewer} · {formatTime(decision.decidedAt)}</em></span>
        </label>)}</div> : remainingTotal ? <div className="review-empty agent-empty-compact"><strong>This batch is finished.</strong><p>{remainingTotal} earlier decisions remain. Load the next batch when ready.</p></div> : <div className="review-empty agent-empty-compact"><strong>Historical decisions are labelled.</strong><p>New reason labels will continue to arrive through the Scout inbox.</p></div>}
        {labelledThisSession.length > 0 && remainingTotal > 0 ? <button className="agent-load-next" onClick={() => window.location.reload()} type="button">Load the next decisions</button> : null}
      </section>

      <section className="agent-rule-workbench">
        <div className="section-intro"><p className="eyebrow">Scoring rules</p><h2>Shadow tests and active versions</h2><p className="section-copy">A passing test still needs separate staff activation. Learned rules may only adjust queue scores; they can never verify a sale or listing.</p></div>
        {!ruleDashboard.ready ? <div className="review-empty agent-empty-compact"><strong>The learning database is not ready.</strong></div> : ruleDashboard.rules.length ? <div className="agent-rule-list">{ruleDashboard.rules.map((rule) => {
          const evaluation = ruleDashboard.evaluations.find((item) => item.rule_version_id === rule.id);
          return <article className={`is-${rule.status}`} key={rule.id}>
            <div><span>{rule.rule_type.replaceAll("_", " ")} · version {rule.version}</span><h3>{rule.rule_key}</h3><b>{rule.status.replaceAll("_", " ")}</b>{evaluation ? <p>{evaluation.passed ? "All promotion gates passed." : "More or better labelled evidence is required."}</p> : <p>Not evaluated yet.</p>}</div>
            {evaluation ? <details><summary>Evaluation gates</summary><ul>{Object.entries(evaluation.gates).map(([name, gate]) => <li key={name} className={gate.passed ? "passed" : "failed"}><span>{name.replaceAll("_", " ")}</span><b>{gate.passed ? "Pass" : "Not ready"}</b><small>{String(gate.actual ?? 0)} / {String(gate.required ?? 0)}</small></li>)}</ul></details> : null}
            <div className="agent-card-actions">
              {rule.status === "candidate" ? <button disabled={Boolean(busy)} onClick={() => runRuleCommand(`reevaluate-${rule.id}`, "reevaluate_scout_rule", rule.id)} type="button">Run shadow test again</button> : null}
              {rule.status === "shadow_passed" ? <button disabled={Boolean(busy)} onClick={() => runRuleCommand(`activate-${rule.id}`, "activate_scout_rule", rule.id)} type="button">Approve activation</button> : null}
              {rule.status === "superseded" ? <button className="secondary" disabled={Boolean(busy)} onClick={() => runRuleCommand(`rollback-${rule.id}`, "rollback_scout_rule", rule.id)} type="button">Restore this version</button> : null}
            </div>
          </article>;
        })}</div> : <div className="review-empty agent-empty-compact"><strong>No rule versions yet.</strong><p>Label decisions first, then let Market Scout propose a safe shadow test.</p></div>}
      </section>
    </div>
  );
}
