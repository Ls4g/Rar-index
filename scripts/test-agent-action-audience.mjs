// Which agent actions reach staff as decisions?
//   node --experimental-strip-types scripts/test-agent-action-audience.mjs
import assert from "node:assert/strict";
import { agentActionAudience } from "../lib/agentActionAudience.ts";

// A click runs something: stays a staff decision.
assert.equal(agentActionAudience("scan_stale_profiles"), "decision");
assert.equal(agentActionAudience("shadow_test_edition_conflicts"), "decision");
assert.equal(agentActionAudience("shadow_test_some_new_rule"), "decision");
// The cards approved and marked done on 16 Nov 2026 without effect.
for (const type of ["review_scout_feedback_conflicts", "review_scout_feedback_precision", "review_scout_feedback_recall", "tune_low_yield_profiles", "review_scout_rule_regression"]) {
  assert.equal(agentActionAudience(type), "developer", type);
}
// Queue reminders: the queue is already on the page.
assert.equal(agentActionAudience("review_sales_evidence"), "reminder");
assert.equal(agentActionAudience("triage_scout_leads"), "reminder");
// Unknown types stay visible rather than silently disappearing.
assert.equal(agentActionAudience("something_new"), "decision");
console.log("agent action audience checks passed");
