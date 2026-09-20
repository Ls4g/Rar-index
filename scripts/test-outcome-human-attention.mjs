import assert from "node:assert/strict";
import { OUTCOME_HUMAN_RECHECK_DAYS, outcomeHumanSnoozedUntil, outcomeNeedsHumanAttention } from "../lib/outcomeHumanAttention.ts";

const decisionTime = "2026-09-20T12:00:00.000Z";
const twoWeeksLater = "2026-10-04T12:00:00.000Z";

assert.equal(OUTCOME_HUMAN_RECHECK_DAYS, 14);
assert.equal(outcomeHumanSnoozedUntil(decisionTime), twoWeeksLater);
assert.equal(outcomeNeedsHumanAttention({ status: "ambiguous", humanAttentionSnoozedUntil: twoWeeksLater }, "2026-10-04T11:59:59.999Z"), false);
assert.equal(outcomeNeedsHumanAttention({ status: "ambiguous", humanAttentionSnoozedUntil: twoWeeksLater }, twoWeeksLater), true);
assert.equal(outcomeNeedsHumanAttention({ status: "inaccessible", humanAttentionSnoozedUntil: null }, decisionTime), true);
assert.equal(outcomeNeedsHumanAttention({ status: "sold_candidate", humanAttentionSnoozedUntil: "2099-01-01T00:00:00.000Z" }, decisionTime), true);

console.log("outcome human-attention cooldown checks passed");
