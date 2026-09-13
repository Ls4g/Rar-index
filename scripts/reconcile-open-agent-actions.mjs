// Reconcile open approved agent actions against what actually happened.
//
//   node --env-file=.env.local scripts/reconcile-open-agent-actions.mjs
//
// READ ONLY. It writes nothing and closes nothing, deliberately: whether an
// approved action is finished is a judgement about work in the world, and
// bulk-labelling 23 of them "executed" would destroy exactly the information
// anyone would later want. What it does is put the evidence next to each one
// so a human can decide in seconds instead of reconstructing it.
//
// For each open action it answers two questions:
//   1. Is this machine-executable, or work a person does?
//   2. Is the underlying work still outstanding?
//
// A machine-executable action with no execution evidence can simply be run.
// A human action whose underlying queue is now empty was done and never
// closed. One whose queue is still full is live work, not clutter.
import { createClient } from "@supabase/supabase-js";
import { isExecutableAgentAction } from "../lib/agentActionExecution.ts";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function countRows(table, apply) {
  const query = admin.from(table).select("id", { count: "exact", head: true });
  const { count, error } = await (apply ? apply(query) : query);
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}

// What "still outstanding" means for each kind of human work, expressed as the
// queue the action was telling someone to go and clear.
const OUTSTANDING_WORK = {
  review_catalogue_queue: () => countRows("catalogue_review_queue"),
  research_catalogue_requests: () => countRows("catalogue_requests", (q) => q.eq("status", "pending")),
  source_missing_covers: () => countRows("cover_candidates", (q) => q.eq("status", "pending")),
  triage_scout_leads: () => countRows("scout_listing_leads", (q) => q.is("reviewed_at", null)),
  review_community_reports: () => countRows("community_sale_reports", (q) => q.eq("status", "pending")),
  review_sales_evidence: () => countRows("price_observations", (q) => q.eq("match_status", "needs_review")),
};

// Deliberately works both before and after the durable-execution migration is
// applied, because reconciling the backlog is exactly the thing you want to do
// while deciding whether to apply it.
const BASE_COLUMNS = "id,agent_key,action_type,status,title,reviewed_by,reviewed_at,created_at,executed_at";
const LEASE_COLUMNS = "execution_status,execution_attempts,last_execution_error";
async function readOpenActions() {
  const withLease = await admin.from("agent_actions").select(`${BASE_COLUMNS},${LEASE_COLUMNS}`)
    .eq("status", "approved").order("reviewed_at", { ascending: true });
  if (!withLease.error) return { rows: withLease.data ?? [], leaseColumns: true };
  if (!/execution_status/.test(withLease.error.message)) return { error: withLease.error.message };
  const base = await admin.from("agent_actions").select(BASE_COLUMNS)
    .eq("status", "approved").order("reviewed_at", { ascending: true });
  if (base.error) return { error: base.error.message };
  return { rows: base.data ?? [], leaseColumns: false };
}
const openResult = await readOpenActions();
if (openResult.error) { console.error("Could not read agent actions:", openResult.error); process.exit(1); }
const open = openResult.rows;
if (!openResult.leaseColumns) console.log("\n(The durable-execution migration is not applied yet, so lease columns are not shown.)");

const { data: ruleVersions } = await admin.from("scout_rule_versions")
  .select("id,rule_key,status,created_at").order("created_at", { ascending: false });
const { data: runs } = await admin.from("agent_runs")
  .select("id,agent_key,status,started_at").order("started_at", { ascending: false }).limit(200);

const now = Date.now();
const summary = { runNow: [], closeAsDone: [], stillOutstanding: [], needsLook: [] };

console.log(`\nOpen approved actions: ${open.length}\n${"=".repeat(70)}`);

for (const action of open) {
  const decidedAt = action.reviewed_at ?? action.created_at;
  const ageHours = Math.round((now - Date.parse(decidedAt)) / 3600000);
  const executable = isExecutableAgentAction(action.action_type);
  console.log(`\n${action.id.slice(0, 8)}  ${action.action_type}`);
  console.log(`  ${action.title}`);
  console.log(`  approved ${ageHours}h ago by ${action.reviewed_by ?? "unknown"} · execution: ${action.execution_status ?? "(column not yet applied)"} · attempts: ${action.execution_attempts ?? 0}`);
  if (action.last_execution_error) console.log(`  last error: ${action.last_execution_error}`);

  if (executable) {
    // Did anything actually run after the approval? For a shadow test that
    // means a candidate rule version; there is no other trace it could leave.
    const since = ruleVersions?.filter((rule) => Date.parse(rule.created_at) > Date.parse(decidedAt)) ?? [];
    const ran = action.action_type.startsWith("shadow_test_") ? since.length > 0 : null;
    if (action.executed_at) {
      console.log("  VERDICT: already executed; the open status is stale.");
      summary.closeAsDone.push(action.id);
    } else if (ran) {
      console.log(`  VERDICT: NEEDS A LOOK. ${since.length} candidate rule version(s) appeared after this approval, so a shadow test may have run under a different action. Compare before re-running.`);
      summary.needsLook.push(action.id);
    } else {
      console.log("  VERDICT: RUN IT. Machine-executable, approved, and no execution evidence exists.");
      summary.runNow.push(action.id);
    }
    continue;
  }

  const probe = OUTSTANDING_WORK[action.action_type];
  if (!probe) {
    console.log("  VERDICT: NEEDS A LOOK. This is human work with no queue RAR can measure, so only a person can say whether it is done.");
    summary.needsLook.push(action.id);
    continue;
  }
  const outstanding = await probe();
  if (outstanding.error) {
    console.log(`  VERDICT: NEEDS A LOOK. Could not read the queue: ${outstanding.error}`);
    summary.needsLook.push(action.id);
  } else if (outstanding.count === 0) {
    console.log("  VERDICT: CLOSE AS DONE. The queue this action pointed at is now empty, so the work was done and the action was never closed.");
    summary.closeAsDone.push(action.id);
  } else {
    console.log(`  VERDICT: STILL OUTSTANDING. ${outstanding.count} item(s) remain in that queue; this is live work, not clutter.`);
    summary.stillOutstanding.push(action.id);
  }
}

const failedRuns = (runs ?? []).filter((run) => run.status !== "succeeded").length;
console.log(`\n${"=".repeat(70)}`);
console.log(`Run it (machine-executable, never ran):   ${summary.runNow.length}`);
console.log(`Close as done (queue already cleared):    ${summary.closeAsDone.length}`);
console.log(`Still outstanding (real live work):       ${summary.stillOutstanding.length}`);
console.log(`Needs a human look:                       ${summary.needsLook.length}`);
console.log(`\nRecent agent runs that did not succeed: ${failedRuns} of ${(runs ?? []).length}`);
console.log("\nNothing was written. Each action is closed or run individually, by a person.\n");
