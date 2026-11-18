// Which Scout leads are followed to a sold candidate (agreed 18 Nov 2026).
//   node --experimental-strip-types scripts/test-follow-lead.mjs
import assert from "node:assert/strict";
import { shouldFollowLead } from "../lib/watchToSale.ts";

assert.equal(shouldFollowLead({ review_status: "watching", match_assessment: { confidence: "partial", score: 50 } }), true);
assert.equal(shouldFollowLead({ review_status: "new", match_assessment: { confidence: "strong", score: 80 } }), true);
assert.equal(shouldFollowLead({ review_status: "new", match_assessment: { score: 75 } }), true);
assert.equal(shouldFollowLead({ review_status: "new", match_assessment: { confidence: "partial", score: 65 } }), false);
assert.equal(shouldFollowLead({ review_status: "new", match_assessment: { confidence: "insufficient", score: 50 } }), false);
assert.equal(shouldFollowLead({ review_status: "new", match_assessment: null }), false);
console.log("follow-lead checks passed");
