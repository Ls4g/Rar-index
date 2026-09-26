// Open approvals: the surface that lets a person run or close work they have
// already approved.
//
// Until this existed, approving an action removed it from every screen. The
// proposal list renders only "proposed", so 22 of 26 open approvals were
// unreachable and the 4 feedback ones rendered as plain text with no
// controls. An approved machine-executable action could not be run, and a
// finished one could not be cleared, so the backlog could only grow.
//
// The invariants below are the ones worth pinning. Closing must never become
// a back door for revising a decision someone made: that is why it is a
// separate command that cannot touch a proposal, cannot reject anything, and
// never rewrites reviewed_by or reviewed_at.
import assert from "node:assert/strict";
import fs from "node:fs";
import { STANDING_QUEUE_ACTIONS, needsHumanApproval } from "../lib/agentPlanning.ts";
import { isExecutableAgentAction } from "../lib/agentActionExecution.ts";

const route = fs.readFileSync(new URL("../app/api/agents/route.ts", import.meta.url), "utf8");
const centre = fs.readFileSync(new URL("../components/AgentControlCentre.tsx", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

let checks = 0;
function check(label, condition) {
  assert.ok(condition, label);
  checks += 1;
  console.log(`  ok   ${label}`);
}

console.log("\n1. Closing an approval is not a decision");
const closeBlock = route.slice(route.indexOf('if (command === "close_action")'), route.indexOf('if (command === "review_action")'));
check("close_action exists", closeBlock.length > 0);
check("closure uses the transactional RPC", /rpc\("close_agent_action"/.test(closeBlock));
check("it never matches a proposal", !/"proposed"/.test(closeBlock));
check("it never rejects anything", !/rejected/.test(closeBlock));
// The original approval is the human's record of their own decision. A close
// is a later, separate event and must not overwrite who decided or when.
check("it does not rewrite reviewed_by", !/reviewed_by/.test(closeBlock));
check("it does not rewrite reviewed_at", !/reviewed_at/.test(closeBlock));

console.log("\n2. A reason is required and recorded");
check("a missing or trivial reason is refused", /reason\.length < 3/.test(closeBlock));
check("the reason is passed to the RPC", /p_reason: reason/.test(closeBlock));
check("RPC failure cannot return success", /if \(error\) return Response.json/.test(closeBlock));
// Database behavior is exercised by test-agent-action-closure.mjs, rather
// than inferred from source patterns. No two-session tests are claimed.
check("each execution attempt has a unique owner", /crypto.randomUUID\(\)/.test(route));

console.log("\n4. The original guarantee still holds");
const reviewBlock = route.slice(route.indexOf('if (command === "review_action")'));
check("a plain decision still requires a proposal", /\.in\("status", execute \? \["proposed", "approved"\] : \["proposed"\]\)/.test(reviewBlock));
check("review_action still accepts only the three decisions", /\["approved", "rejected", "cancelled"\]\.includes\(decision\)/.test(reviewBlock));

console.log("\n5. The approvals are actually on the page");
check("approved actions are collected", /const openApprovals = actions\.filter/.test(centre));
check("they are filtered on the approved status", /action\.status === "approved" && !resolvedActionIds\.has\(action\.id\)/.test(centre));
check("the section is rendered", /id="agent-open-approvals"/.test(centre));
check("the summary links to it", /href="#agent-open-approvals"/.test(centre));
check("an executable approval can be run", /command: "review_action", actionId: action\.id, decision: "approved", execute: true/.test(centre));
check("closing posts the new command", /command: "close_action"/.test(centre));
// The API refuses a short reason, so the button must not offer a round trip
// that can only fail.
check("the close button is dead without a reason", /reason\.trim\(\)\.length < 3/.test(centre));
check("a closed action disappears without a reload", /body\.command === "close_action"/.test(centre));

console.log("\n6. The reason field is legible");
// .agent-proposal-list span is an uppercase orange eyebrow; a plain label
// inside that list has to opt out of it or it reads as a heading.
check("the label opts out of the eyebrow styling", /\.agent-close-reason span \{[^}]*text-transform: none/.test(css));
check("the input is styled", /\.agent-close-reason input \{/.test(css));

console.log("\n7. A standing queue is reported, not raised as a decision");
const runtime = fs.readFileSync(new URL("../lib/agentRuntime.ts", import.meta.url), "utf8");
// The fifteen of September 2026's twenty-six open approvals that were only
// ever "this queue has N items in it".
for (const actionType of ["triage_scout_leads", "review_catalogue_queue", "source_missing_covers", "review_sales_evidence", "resolve_readiness_bottleneck"]) {
  check(`${actionType} no longer needs a decision`, !needsHumanApproval(actionType));
}
// Anything a machine carries out must still be a decision -- that is the
// entire point of the approval gate, and quietly auto-running work would be
// the worst possible reading of "fewer approvals".
for (const actionType of ["scan_stale_profiles", "shadow_test_multi_volume_detection", "shadow_test_first_print_proof_gate"]) {
  check(`${actionType} still needs a decision`, needsHumanApproval(actionType));
  check(`${actionType} is genuinely machine-executable`, isExecutableAgentAction(actionType));
}
check("no executable action was retired by mistake", [...STANDING_QUEUE_ACTIONS].every((actionType) => !isExecutableAgentAction(actionType)));
check("a proposed change of behaviour still needs a decision", needsHumanApproval("review_scout_rule_regression") && needsHumanApproval("review_scout_feedback_precision"));

check("the runtime filters before creating anything", /allProposals\.filter\(\(proposal\) => needsHumanApproval\(proposal\.actionType\)\)/.test(runtime));
// The plan is filtered at the point of writing, not at the point of planning,
// so each run's summary and metrics still carry the counts.
check("the count survives on the run", /queues_reported_not_raised/.test(runtime));
check("already-open ones are retired", /standing_queue_proposals_retired/.test(runtime));
// An approval is a decision a person made. A rule change must not reach in
// and close it on their behalf.
const retireBlock = runtime.slice(runtime.indexOf("const retiredIds"), runtime.indexOf("const remaining"));
check("only untouched proposals are retired", /action\.status === "proposed"/.test(retireBlock));
check("the retirement is conditioned on the status", /\.eq\("status", "proposed"\)/.test(retireBlock));
check("the retired row says what happened", /reported as a live count/.test(retireBlock));

console.log("\n8. The retired counts are still on screen");
check("the catalogue queue has a live count", /catalogueQueueCount/.test(centre) && /href="\/catalogue-review"/.test(centre));
check("missing covers have a live count", /missingCoverCount/.test(centre) && /href="\/cover-review"/.test(centre));
check("public requests have a live count", /catalogueRequestCount/.test(centre) && /href="\/catalogue-requests"/.test(centre));
check("they read the Curator's own figures", /catalogueRun\?\.metrics\?\.catalogue_queue_pending/.test(centre));

console.log(`\nPASSED: ${checks}/${checks} checks\n`);
