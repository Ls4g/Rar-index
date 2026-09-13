import assert from "node:assert/strict";
import { createAndEvaluateScoutRule } from "../lib/scoutRuleEvaluation.ts";

const action = { id: "proposal", action_type: "shadow_test_first_print_proof_gate" };
function database(failEvaluation = false, lookupError = false) {
  const rule = { id: "same-version", rule_key: "first-print-proof", version: 1, rule_type: "first_print_proof", config: {}, status: "candidate", created_at: "2026-08-01T00:00:00Z" };
  const state = { rule, evaluations: 0, candidateInserts: 0 };
  return { state, from(table) {
    let filters = []; let values; let inserting = false;
    const result = () => {
      if (table === "agent_incidents") return { data: null, error: null };
      if (table === "scout_lead_decisions") return { data: [], error: null };
      if (table === "scout_rule_evaluations") {
        if (failEvaluation) return { data: null, error: { message: "injected audit failure" } };
        state.evaluations++; return { data: null, error: null };
      }
      assert.equal(table, "scout_rule_versions");
      if (inserting) state.candidateInserts++;
      if (lookupError) return { data: null, error: { message: "injected lookup failure" } };
      if (filters.some(([key, value]) => key === "status" && value === "active")) return { data: [], error: null };
      if (values) Object.assign(rule, values);
      return { data: rule, error: null };
    };
    const q = { select() { return q; }, eq(k,v) { filters.push([k,v]); return q; }, in() { return q; }, order() { return q; }, range() { return q; }, limit() { return q; },
      update(v) { values=v; return q; }, insert(v) { inserting=true; values=v; return q; },
      maybeSingle: async () => result(), single: async () => result(), then(resolve, reject) { return Promise.resolve(result()).then(resolve,reject); } };
    return q;
  }};
}
const db = database();
const result = await createAndEvaluateScoutRule(db, action, "SP");
assert.equal(result.id, "same-version");
assert.equal(db.state.candidateInserts, 0);
assert.equal(db.state.evaluations, 1, "retry must actually evaluate the previously inserted candidate");
assert.ok(result.tested_at);
assert.equal(result.status, "candidate", "empty benchmark must never activate a rule");
assert.equal(result.created_at, "2026-08-01T00:00:00Z", "retry preserves prospective holdout cutoff");
await assert.rejects(createAndEvaluateScoutRule(database(true), action, "SP"), /save the shadow evaluation/);
await assert.rejects(createAndEvaluateScoutRule(database(false,true), action, "SP"), /check for an existing/);
console.log("Shadow-test retry passed: resume same version, run and audit evaluation, preserve safety gates, propagate failures.");
