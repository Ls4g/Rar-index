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
//
// The measure has to be the same one the planner used to raise the action, or
// the verdict is about different work. `triage_scout_leads` counted every lead
// with no reviewed_at -- 9657 rows, including years of parked and dismissed
// ones -- against an action that said "review 110 current, plausible
// marketplace leads". It reported a backlog 88x larger than the job. Where the
// planner recorded its own figure in the action's evidence, that figure wins.
const OUTSTANDING_WORK = {
  review_catalogue_queue: () => countRows("catalogue_review_queue"),
  research_catalogue_requests: () => countRows("catalogue_requests", (q) => q.eq("status", "pending")),
  source_missing_covers: () => countRows("cover_candidates", (q) => q.eq("status", "pending")),
  triage_scout_leads: () => countRows("scout_listing_leads", (q) => q.eq("review_status", "new")),
  review_community_reports: () => countRows("community_sale_reports", (q) => q.eq("status", "pending")),
  review_sales_evidence: () => countRows("price_observations", (q) => q.eq("match_status", "needs_review")),
};

// The planner's own metric for each recurring job, read from the evidence it
// stored on the action. Live metric names, not historical copies.
const PLANNER_METRIC = {
  triage_scout_leads: "scout_review_now",
  source_missing_covers: "verified_editions_missing_covers",
  review_catalogue_queue: "catalogue_queue_pending",
  research_catalogue_requests: "catalogue_requests_pending",
};

// Deliberately works both before and after the durable-execution migration is
// applied, because reconciling the backlog is exactly the thing you want to do
// while deciding whether to apply it.
const BASE_COLUMNS = "id,agent_key,action_type,status,title,dedupe_key,evidence,reviewed_by,reviewed_at,created_at,executed_at";
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
  .select("id,agent_key,status,started_at,finished_at,error_message,trigger_source")
  .order("started_at", { ascending: false }).limit(200);

const now = Date.now();
const summary = { runNow: [], closeAsDone: [], stillOutstanding: [], needsLook: [], superseded: [] };

// A recurring job whose workload count changed used to produce a brand new
// action every run, because the coverage check compared titles exactly. Each
// was approved and the previous approval was left open, so one standing queue
// could hold four simultaneous approvals. The planner no longer does this, but
// the backlog it created is still here, and only a person can close a decision
// they made -- so group them and say plainly which is current.
const newestByJob = new Map();
for (const action of open) {
  const job = action.dedupe_key ?? `${action.agent_key}:${action.action_type}`;
  const decided = Date.parse(action.reviewed_at ?? action.created_at);
  const held = newestByJob.get(job);
  if (!held || decided > held.decided) newestByJob.set(job, { id: action.id, decided });
}
const jobCounts = new Map();
for (const action of open) {
  const job = action.dedupe_key ?? `${action.agent_key}:${action.action_type}`;
  jobCounts.set(job, (jobCounts.get(job) ?? 0) + 1);
}

console.log(`\nOpen approved actions: ${open.length}`);
const duplicated = [...jobCounts.values()].filter((count) => count > 1);
if (duplicated.length) {
  const extra = duplicated.reduce((total, count) => total + count - 1, 0);
  console.log(`Distinct jobs: ${jobCounts.size}. ${extra} of these approvals are older instances of a job that has since been approved again.`);
}
console.log("=".repeat(70));

for (const action of open) {
  const decidedAt = action.reviewed_at ?? action.created_at;
  const ageHours = Math.round((now - Date.parse(decidedAt)) / 3600000);
  const executable = isExecutableAgentAction(action.action_type);
  const job = action.dedupe_key ?? `${action.agent_key}:${action.action_type}`;
  const isNewestOfJob = newestByJob.get(job)?.id === action.id;
  const siblings = (jobCounts.get(job) ?? 1) - 1;
  console.log(`\n${action.id.slice(0, 8)}  ${action.action_type}`);
  console.log(`  ${action.title}`);
  console.log(`  approved ${ageHours}h ago by ${action.reviewed_by ?? "unknown"} · execution: ${action.execution_status ?? "(column not yet applied)"} · attempts: ${action.execution_attempts ?? 0}`);
  if (action.last_execution_error) console.log(`  last error: ${action.last_execution_error}`);

  // What the planner itself said the workload was when it raised this action,
  // next to what that same measure says now.
  const metric = PLANNER_METRIC[action.action_type];
  if (metric && action.evidence && typeof action.evidence[metric] === "number") {
    console.log(`  the planner raised this for ${action.evidence[metric]} item(s) (${metric})`);
  }

  if (siblings > 0 && !isNewestOfJob) {
    console.log(`  DUPLICATE: the same job has been approved ${siblings} more time(s) since; the newest is ${newestByJob.get(job).id.slice(0, 8)}.`);
    console.log("  VERDICT: SUPERSEDED. The work is covered by the newer approval. Close this one to clear the backlog; nothing is lost, the audit row stays.");
    summary.superseded.push(action.id);
    continue;
  }
  if (siblings > 0) console.log(`  This is the current approval for its job; ${siblings} older one(s) are superseded.`);

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

const failed = (runs ?? []).filter((run) => run.status !== "succeeded");
console.log(`\n${"=".repeat(70)}`);
console.log(`Superseded by a newer approval of the same job: ${summary.superseded.length}`);
console.log(`Run it (machine-executable, never ran):         ${summary.runNow.length}`);
console.log(`Close as done (queue already cleared):          ${summary.closeAsDone.length}`);
console.log(`Still outstanding (real live work):             ${summary.stillOutstanding.length}`);
console.log(`Needs a human look:                             ${summary.needsLook.length}`);

if (runs?.length) {
  const oldest = runs[runs.length - 1]?.started_at;
  const newest = runs[0]?.started_at;
  console.log(`\nAgent runs examined: ${runs.length}, from ${oldest} to ${newest}.`);
  console.log(`Runs that did not succeed: ${failed.length}`);
  const byReason = new Map();
  for (const run of failed) {
    const reason = run.error_message ?? "no error recorded";
    byReason.set(reason, [...(byReason.get(reason) ?? []), run]);
  }
  for (const [reason, group] of byReason) {
    const last = group.map((run) => Date.parse(run.started_at)).sort((a, b) => b - a)[0];
    const daysSince = Math.floor((now - last) / 86_400_000);
    console.log(`  ${group.length}x ${reason}`);
    console.log(`     agents: ${[...new Set(group.map((run) => run.agent_key))].join(", ")} · most recent ${daysSince} day(s) ago`);
  }
  if (failed.length && Math.floor((now - Math.max(...failed.map((run) => Date.parse(run.started_at)))) / 86_400_000) >= 7) {
    console.log("  None of these are recent. Check whether the cause was configuration that has since been fixed before retrying anything.");
  }
}
console.log("\nNothing was written. Each action is closed or run individually, by a person.\n");
