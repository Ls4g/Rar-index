import assert from "node:assert/strict";
import fs from "node:fs";
import { priorShadowRuleForAction, ruleCandidateForAction } from "../lib/scoutRuleEvaluation.ts";

function version(action, evidence = null, status = "candidate") {
  const candidate = ruleCandidateForAction(action, [], evidence);
  assert.ok(candidate);
  return { id: `${action}-${status}`, rule_key: candidate.key, rule_type: candidate.type,
    version: 1, config: candidate.config, status };
}

const firstPrint = "shadow_test_first_print_proof_gate";
const multiVolume = "shadow_test_multi_volume_detection";
const editionConflict = "shadow_test_edition_conflicts";
const olderLabels = { sample_size: 4, examples: [{ listingTitle: "First Print Hunter x Hunter Vol 1" }] };
const newerLabels = { sample_size: 11, examples: [{ listingTitle: "First Print One Piece Vol 1" }] };

assert.equal(priorShadowRuleForAction({ action_type: firstPrint, evidence: newerLabels }, [version(firstPrint, olderLabels)])?.rule_key,
  "first-print-proof", "more labels must not create the same rule a second time");
assert.equal(priorShadowRuleForAction({ action_type: multiVolume, evidence: newerLabels }, [version(multiVolume, olderLabels, "rejected")])?.status,
  "rejected", "a failed experiment remains prior art");
assert.equal(priorShadowRuleForAction({ action_type: editionConflict,
  evidence: { examples: [{ listingTitle: "Berserk Deluxe Edition Vol 1" }] } },
  [version(editionConflict, { examples: [{ listingTitle: "One Piece Deluxe Edition Vol 1" }] }, "active")])?.status,
  "active", "same derived phrase is the same experiment despite a new series");
assert.equal(priorShadowRuleForAction({ action_type: editionConflict,
  evidence: { examples: [{ listingTitle: "Berserk Omnibus Vol 1" }] } },
  [version(editionConflict, { examples: [{ listingTitle: "One Piece Deluxe Edition Vol 1" }] })]), null,
  "genuinely different phrase configuration may be tested");
assert.equal(priorShadowRuleForAction({ action_type: firstPrint, evidence: newerLabels },
  [{ ...version(firstPrint, olderLabels), config: { ...version(firstPrint, olderLabels).config, future_gate: true } }]), null,
  "a new config field must not be mistaken for the same tested rule");
assert.throws(() => priorShadowRuleForAction({ action_type: editionConflict,
  evidence: { examples: [{ listingTitle: "Plain Vol 1" }] } }, []), /safe edition phrase/,
  "unbuildable title evidence must not be offered as a one-click test");

const runtime = fs.readFileSync(new URL("../lib/agentRuntime.ts", import.meta.url), "utf8");
const page = fs.readFileSync(new URL("../app/agents/page.tsx", import.meta.url), "utf8");
const centre = fs.readFileSync(new URL("../components/AgentControlCentre.tsx", import.meta.url), "utf8");
assert.match(runtime, /coveredShadowKeys\.has\(item\.dedupeKey\)/);
assert.match(runtime, /\.eq\("status", "proposed"\)\.select\("id"\)/,
  "automated cleanup must never overwrite an approved human decision");
assert.match(page, /action\.status !== "proposed"/,
  "only unreviewed repeat proposals should disappear from the page");
assert.match(centre, /Latest Scout learning tests/);
assert.match(centre, /Caught \$\{Math\.round\(coverage\.actual \* 100\)\}%/,
  "the staff page explains measured test results, not synthetic confidence");
console.log("Agent shadow proposal dedupe passed: repeated tests suppressed, changed rules still possible, human approvals preserved.");
