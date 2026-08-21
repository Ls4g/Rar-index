import assert from "node:assert/strict";
import { shouldTripCircuitBreaker, summarizeAgentCycleResults } from "../lib/agentCyclePolicy.ts";

const healthy = summarizeAgentCycleResults([
  { agentKey: "catalogue_curator", ok: true, status: "succeeded" },
  { agentKey: "market_scout", ok: true, status: "succeeded" },
  { agentKey: "evidence_auditor", ok: true, status: "succeeded" },
  { agentKey: "rar_operator", ok: true, status: "succeeded" },
]);
assert.deepEqual({ successful: healthy.successful, failed: healthy.failed, blocked: healthy.blocked }, { successful: 4, failed: 0, blocked: 0 });

const degraded = summarizeAgentCycleResults([
  { agentKey: "catalogue_curator", ok: true, status: "succeeded" },
  { agentKey: "market_scout", ok: false, status: "failed", error: "API unavailable" },
  { agentKey: "evidence_auditor", ok: true, status: "succeeded" },
  { agentKey: "rar_operator", ok: true, status: "succeeded" },
]);
assert.deepEqual({ successful: degraded.successful, failed: degraded.failed, blocked: degraded.blocked }, { successful: 3, failed: 1, blocked: 0 });
assert.match(degraded.summary, /market scout/);

const safelyBlocked = summarizeAgentCycleResults([
  { agentKey: "catalogue_curator", ok: true, status: "blocked" },
  { agentKey: "market_scout", ok: true, status: "blocked" },
  { agentKey: "evidence_auditor", ok: true, status: "blocked" },
  { agentKey: "rar_operator", ok: true, status: "blocked" },
]);
assert.deepEqual({ successful: safelyBlocked.successful, failed: safelyBlocked.failed, blocked: safelyBlocked.blocked }, { successful: 0, failed: 0, blocked: 4 });
assert.equal(shouldTripCircuitBreaker(0, 2, safelyBlocked.failed), false, "a deliberate safety pause is not a technical failure");
assert.equal(shouldTripCircuitBreaker(0, 2, 1), false, "one failed cycle is reported but does not stop the system");
assert.equal(shouldTripCircuitBreaker(1, 2, 1), true, "the second consecutive failed cycle trips the breaker");
assert.equal(shouldTripCircuitBreaker(4, 2, 0), false, "a healthy cycle never trips the breaker");

console.log("Agent Phase 5 guarded-cycle tests passed (health accounting and circuit breaker).\n");
