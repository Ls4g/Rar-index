import assert from "node:assert/strict";
import { planAgentActions } from "../lib/agentPlanning.ts";

const catalogue = planAgentActions("catalogue_curator", {
  catalogue_queue_pending: 4,
  catalogue_requests_pending: 0,
  verified_editions_missing_covers: 7,
});
assert.equal(catalogue.proposals.length, 2);
assert.deepEqual(catalogue.proposals.map((item) => item.actionType), ["review_catalogue_queue", "source_missing_covers"]);

const scout = planAgentActions("market_scout", {
  active_search_profiles: 20,
  stale_search_profiles: 3,
  new_scout_leads: 18,
  watching_scout_leads: 2,
});
assert.equal(scout.proposals.length, 2);
assert.ok(scout.summary.includes("18 new leads"));

const evidence = planAgentActions("evidence_auditor", {
  sales_needing_review: 0,
  sales_needing_print_classification: 5,
  community_reports_pending: 1,
});
assert.equal(evidence.proposals.length, 2);
assert.equal(evidence.proposals[0].dedupeKey, "evidence:classify-printing");

const operator = planAgentActions("rar_operator", {
  readiness_profile_needed: 9,
  readiness_under_review: 2,
  failed_agent_runs_24h: 1,
  open_agent_proposals: 3,
});
assert.equal(operator.proposals.length, 2);
assert.ok(operator.proposals[0].title.includes("profile needed"));

const clear = planAgentActions("evidence_auditor", {
  sales_needing_review: 0,
  sales_needing_print_classification: 0,
  community_reports_pending: 0,
});
assert.equal(clear.proposals.length, 0);

console.log("Agent planning tests passed (5 scenarios).");
