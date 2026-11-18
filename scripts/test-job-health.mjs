// When does a scheduled job raise the staff alert?
//
//   node --experimental-strip-types scripts/test-job-health.mjs
import assert from "node:assert/strict";
import { assessJobHealth } from "../lib/jobHealth.ts";
import { classifyCronError, summarizeCronResponse } from "../lib/cronHeartbeat.ts";

const NOW = Date.parse("2026-11-14T15:00:00Z");
const JOB = [{ route: "/api/cron/agent-reliability", label: "Agent reliability check" }];
const run = (daysAgo, status, summary = {}) => ({
  route: "/api/cron/agent-reliability",
  started_at: new Date(NOW - daysAgo * 86_400_000).toISOString(),
  finished_at: status === "started" ? null : new Date(NOW - daysAgo * 86_400_000 + 12_000).toISOString(),
  status, summary,
});
const check = (runs) => assessJobHealth(runs, NOW, JOB);

// Healthy: nothing to show.
assert.deepEqual(check([run(0.1, "completed"), run(1.1, "completed")]), []);
// "partial" (e.g. agents that ran but did not pass their gates) is not a failure.
assert.deepEqual(check([run(0.1, "partial"), run(1.1, "partial")]), []);

// One failure: watch, not alert.
let result = check([run(0.1, "failed", { error_kind_provider: true }), run(1.1, "completed")]);
assert.equal(result[0].severity, "watch");
assert.deepEqual(result[0].where, ["error_kind_provider"]);

// The autumn 2026 reliability pattern: failing every day. Alert, with the streak and since-date.
result = check([run(0.1, "failed", { failed_sync: true }), run(1.1, "failed"), run(2.1, "failed"), run(3.1, "completed")]);
assert.equal(result[0].severity, "alert");
assert.match(result[0].reason, /Failed 3 runs in a row/);
assert.equal(result[0].since, run(2.1, "failed").started_at);
assert.deepEqual(result[0].where, ["failed_sync"]);

// Not running at all for two days: alert.
result = check([run(2, "completed")]);
assert.equal(result[0].severity, "alert");
assert.match(result[0].reason, /Has not run/);

// Started and never reported back (killed): watch; twice running counts as failures.
result = check([run(0.2, "started"), run(1.1, "completed")]);
assert.equal(result[0].severity, "watch");
assert.match(result[0].reason, /never reported/);
result = check([run(0.2, "started"), run(1.1, "started"), run(2.1, "completed")]);
assert.equal(result[0].severity, "alert");

// A run that is still going (started 10 minutes ago) is not a problem yet.
assert.deepEqual(check([{ ...run(0, "started"), started_at: new Date(NOW - 600_000).toISOString() }, run(1, "completed")]), []);

// Never recorded: watch.
assert.equal(check([])[0].severity, "watch");

// Error kinds are fixed words, never the message.
assert.equal(classifyCronError("Reliability benchmarks could not be saved: duplicate key value violates unique constraint"), "database");
assert.equal(classifyCronError("eBay sold listings are temporarily unavailable due to an ongoing service outage"), "provider");
assert.equal(classifyCronError("Request timed out after 300s"), "timeout");
assert.equal(classifyCronError("JWT expired"), "auth");
assert.equal(classifyCronError("Scheduled job failed. Inspect its existing operational records."), "unknown");
const summary = summarizeCronResponse("exchange-rates", 502, { error: "ECB fetch failed: ECONNRESET secret=abc" });
assert.equal(summary.status, "failed");
assert.equal(summary.summary.error_kind_provider, true);
assert.ok(!JSON.stringify(summary).includes("secret"));

console.log("job health checks passed");

// Every run in the window failed: say so rather than undercounting.
{
  const all = assessJobHealth([run(0.1, "failed"), run(1.1, "failed")], NOW, JOB);
  assert.match(all[0].reason, /every run in the last 10 days/);
  console.log("streak wording check passed");
}
