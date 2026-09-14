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
check("it only ever matches an approved action", /\.eq\("status", "approved"\)/.test(closeBlock));
check("it never matches a proposal", !/"proposed"/.test(closeBlock));
check("it never rejects anything", !/rejected/.test(closeBlock));
// The original approval is the human's record of their own decision. A close
// is a later, separate event and must not overwrite who decided or when.
check("it does not rewrite reviewed_by", !/reviewed_by/.test(closeBlock));
check("it does not rewrite reviewed_at", !/reviewed_at/.test(closeBlock));
check("it writes the terminal status", /status: "cancelled"/.test(closeBlock));

console.log("\n2. A reason is required and recorded");
check("a missing or trivial reason is refused", /reason\.length < 3/.test(closeBlock));
check("the reason is kept in review_notes", /review_notes/.test(closeBlock));
check("the close is appended, not substituted for the existing notes", /action\.review_notes/.test(closeBlock));
check("an audit event is written", /agent_action_events/.test(closeBlock));
check("the event records that nothing was executed", /closed_without_executing/.test(closeBlock));

console.log("\n3. It cannot strand a running worker or race another close");
check("a live lease refuses the close", /execution_status === "running"/.test(closeBlock));
check("the lease expiry is what makes it live", /lease_expires_at/.test(closeBlock));
// Conditioning the UPDATE on the status is what makes two simultaneous closes
// resolve to one winner rather than both reporting success.
const updateClause = closeBlock.slice(closeBlock.indexOf("from(\"agent_actions\").update"));
check("the update is conditioned on the status", /\.eq\("status", "approved"\)/.test(updateClause));
check("losing that race is reported, not swallowed", /Another request closed this action first/.test(closeBlock));

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

console.log(`\nPASSED: ${checks}/${checks} checks\n`);
