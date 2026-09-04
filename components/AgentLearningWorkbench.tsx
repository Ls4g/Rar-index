"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useStaffReviewer } from "@/lib/useStaffReviewer";

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

export default function AgentLearningWorkbench({
  ruleDashboard,
}: {
  ruleDashboard: ScoutRuleDashboard;
}) {
  const router = useRouter();
  const [reviewer, setReviewer] = useStaffReviewer();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

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

  return (
    <div className="agent-control-content">
      <section className="agent-identity-bar">
        <label><span>Staff name</span><input onChange={(event) => setReviewer(event.target.value)} placeholder="e.g. SP" value={reviewer} /></label>
        <p>{message || "Saved on this device and attached to every learning decision."}</p>
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
        })}</div> : <div className="review-empty agent-empty-compact"><strong>No rule versions yet.</strong><p>New Watch and Dismiss decisions feed Scout&apos;s evaluation evidence automatically.</p></div>}
      </section>
    </div>
  );
}
