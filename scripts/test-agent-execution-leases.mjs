// Durable agent execution, against a real PostgreSQL engine.
//
//   node scripts/test-agent-execution-leases.mjs
//
// Runs the shipped migration inside PGlite. The rules under test are the ones
// the audit found broken: approval and execution are different questions with
// different owners; a crashed worker's work is retryable and never silently
// marked complete; and a completed side effect is never replayed.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}
function checkRaises(name, error, fragment) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const ok = Boolean(error) && message.toLowerCase().includes(fragment.toLowerCase());
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected a message containing "${fragment}", got ${JSON.stringify(message)})`}`);
}

const db = await new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.agent_runs (id uuid primary key default gen_random_uuid());
  create table public.agent_controls (agent_key text primary key);
  create table public.agent_actions (
    id uuid primary key default gen_random_uuid(),
    run_id uuid not null references public.agent_runs(id),
    agent_key text not null references public.agent_controls(agent_key),
    action_type text not null, target_type text not null, target_id text,
    dedupe_key text not null, title text not null, rationale text not null,
    risk_level text not null default 'low',
    confidence numeric(5,4),
    status text not null default 'proposed'
      check (status in ('proposed','approved','rejected','executed','cancelled')),
    evidence jsonb not null default '{}'::jsonb,
    proposed_payload jsonb not null default '{}'::jsonb,
    reviewed_by text, review_notes text, reviewed_at timestamptz,
    created_at timestamptz not null default now(), executed_at timestamptz
  );
  create table public.agent_action_events (
    id bigint generated always as identity primary key,
    action_id uuid not null references public.agent_actions(id),
    previous_status text, next_status text not null, actor text not null,
    notes text, details jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  insert into public.agent_controls values ('rar_operator');
`);
const { rows: [{ id: runId }] } = await db.query("insert into public.agent_runs default values returning id");

// An action that already ran, to prove the backfill records it as succeeded
// and can never replay it.
const { rows: [{ id: legacyExecuted }] } = await db.query(
  `insert into public.agent_actions (run_id, agent_key, action_type, target_type, dedupe_key, title, rationale, status, reviewed_by, reviewed_at, executed_at)
   values ($1,'rar_operator','scan_stale_profiles','marketplace_search_profiles','legacy-done','Ran already','because','executed','SP',now(),now()) returning id`, [runId]);

await db.exec(readFileSync(new URL("../supabase/migrations/20260913_durable_agent_execution.sql", import.meta.url), "utf8"));
console.log("loaded shipped migration: durable_agent_execution");

let n = 0;
async function makeAction(overrides = {}) {
  n += 1;
  const row = { status: "approved", action_type: "shadow_test_lot_detection", ...overrides };
  const { rows: [{ id }] } = await db.query(
    `insert into public.agent_actions (run_id, agent_key, action_type, target_type, dedupe_key, title, rationale, status, reviewed_by, review_notes, reviewed_at)
     values ($1,'rar_operator',$2,'scout_rule_versions',$3,'Shadow-test lot detection','labelled misses',$4,'SP','Worth trying.', now()) returning id`,
    [runId, row.action_type, `dedupe-${n}`, row.status]);
  return id;
}
async function claim(id, owner = "worker-1", seconds = 300) {
  const { rows } = await db.query("select public.claim_agent_action($1,$2,$3) as r", [id, owner, seconds]);
  return rows[0].r;
}
async function finish(id, owner, succeeded, error = null, notes = null) {
  const { rows } = await db.query("select public.finish_agent_action($1,$2,$3,$4,$5) as r", [id, owner, succeeded, error, notes]);
  return rows[0].r;
}
async function recover() {
  const { rows } = await db.query("select public.recover_expired_agent_action_leases() as r");
  return rows[0].r;
}
async function row(id) {
  const { rows: [r] } = await db.query(
    `select status, execution_status, lease_owner, execution_attempts, last_execution_error,
            executed_at is not null as has_executed_at, reviewed_by, review_notes,
            reviewed_at is not null as has_reviewed_at
       from public.agent_actions where id = $1`, [id]);
  return r;
}
async function events(id) {
  const { rows } = await db.query("select next_status, actor from public.agent_action_events where action_id = $1 order by id", [id]);
  return rows.map((e) => `${e.next_status}@${e.actor}`);
}

console.log("\n--- the backfill does not replay work that already ran ---");
{
  check("an already-executed action is recorded as succeeded", (await row(legacyExecuted)).execution_status, "succeeded");
  let error = null;
  try { await claim(legacyExecuted); } catch (caught) { error = caught; }
  checkRaises("and cannot be claimed again", error, "already run");
}

console.log("\n--- approval and execution are different questions ---");
{
  // The exact bug behind the 6 stuck machine-executable actions: approving
  // without running used to lock execution out for ever.
  const id = await makeAction({ status: "approved" });
  check("an approved action starts not_started, not executed", (await row(id)).execution_status, "not_started");
  const claimed = await claim(id);
  check("an action approved earlier can still be claimed later", claimed.ok, true);
  check("this is its first attempt", claimed.attempt, 1);
  await finish(id, "worker-1", true, null, "Shadow test ran; candidate rule not activated.");
  const after = await row(id);
  check("success advances the approval axis to executed", after.status, "executed");
  check("and records the run", [after.execution_status, after.has_executed_at], ["succeeded", true]);
  check("the approval identity is untouched", [after.reviewed_by, after.review_notes], ["SP", "Worth trying."]);
  check("the audit trail shows claim and finish", await events(id), ["execution_claimed@worker-1", "execution_succeeded@worker-1"]);
}
for (const status of ["proposed", "rejected", "cancelled"]) {
  const id = await makeAction({ status });
  let error = null;
  try { await claim(id); } catch (caught) { error = caught; }
  checkRaises(`a "${status}" action cannot be run`, error, "Only an approved action");
  check(`and is left alone`, (await row(id)).execution_status, "not_started");
}

console.log("\n--- two workers cannot run the same action ---");
{
  const id = await makeAction();
  await claim(id, "worker-1");
  let error = null;
  try { await claim(id, "worker-2"); } catch (caught) { error = caught; }
  checkRaises("a second worker is refused while the lease holds", error, "Another worker (worker-1)");
  check("and the attempt count does not move", (await row(id)).execution_attempts, 1);
  // A duplicate request from the SAME worker is also refused: the lease is the
  // claim, not the identity.
  error = null;
  try { await claim(id, "worker-1"); } catch (caught) { error = caught; }
  checkRaises("even the same worker cannot double-claim", error, "Another worker");
}

console.log("\n--- a crashed worker is recovered, never assumed finished ---");
{
  const id = await makeAction();
  await claim(id, "worker-crash", 30);
  // Simulate the worker dying: its lease lapses with nothing reported.
  await db.query("update public.agent_actions set lease_expires_at = now() - interval '1 minute' where id = $1", [id]);
  const recovered = await recover();
  check("the expired lease is recovered", recovered.recovered, 1);
  const after = await row(id);
  check("it is failed, never succeeded", after.execution_status, "failed");
  check("the approval is intact so it stays retryable", after.status, "approved");
  check("nothing claims the work completed", after.has_executed_at, false);
  check("the reason says the outcome is unknown", after.last_execution_error.includes("Whether the work completed is unknown"), true);
  check("the lease is released", after.lease_owner, null);
  check("the expiry is audited", (await events(id)).includes("execution_lease_expired@RAR Agent System"), true);

  // And the whole point: it can be retried, keeping its history.
  const retry = await claim(id, "worker-2");
  check("a recovered action can be retried", retry.ok, true);
  check("as a second attempt, not a first", retry.attempt, 2);
  await finish(id, "worker-2", true);
  check("and finishes cleanly", (await row(id)).execution_status, "succeeded");
}
{
  // The worker that comes back from the dead after being taken over.
  const id = await makeAction();
  await claim(id, "worker-zombie", 30);
  await db.query("update public.agent_actions set lease_expires_at = now() - interval '1 minute' where id = $1", [id]);
  await recover();
  await claim(id, "worker-live");
  let error = null;
  try { await finish(id, "worker-zombie", true); } catch (caught) { error = caught; }
  checkRaises("the lapsed worker cannot finish work it no longer owns", error, "owned by worker-live");
  check("and the live run is untouched", (await row(id)).execution_status, "running");
}

console.log("\n--- a lapsed lease is claimable without waiting for recovery ---");
{
  const id = await makeAction();
  await claim(id, "worker-1", 30);
  await db.query("update public.agent_actions set lease_expires_at = now() - interval '1 second' where id = $1", [id]);
  const retaken = await claim(id, "worker-2");
  check("another worker can take over a lapsed lease", retaken.reclaimed, true);
  check("keeping the attempt history", retaken.attempt, 2);
}

console.log("\n--- a failure is retryable and says why ---");
{
  const id = await makeAction();
  await claim(id, "worker-1");
  await finish(id, "worker-1", false, "18 of 30 profiles checked; eBay returned 429 for the rest.");
  const after = await row(id);
  check("the run is failed", after.execution_status, "failed");
  check("the approval survives, so staff are not asked to approve it again", after.status, "approved");
  check("the reason is kept for the retry", after.last_execution_error.includes("429"), true);
  check("it is not marked as executed", after.has_executed_at, false);
  const retry = await claim(id, "worker-1");
  check("and it can be retried", retry.attempt, 2);
}
{
  const id = await makeAction();
  await claim(id, "worker-1");
  let error = null;
  try { await finish(id, "worker-1", false, null); } catch (caught) { error = caught; }
  checkRaises("a failure with no reason is refused", error, "must record why");
  check("so the run stays open rather than closing blind", (await row(id)).execution_status, "running");
}

console.log("\n--- finishing something that is not running ---");
{
  const id = await makeAction();
  let error = null;
  try { await finish(id, "worker-1", true); } catch (caught) { error = caught; }
  checkRaises("finishing an unclaimed action is refused", error, "not currently running");
}
{
  // A duplicate finish from the same owner is idempotent, not an error: the
  // retry of a request whose response was lost must not look like a failure.
  const id = await makeAction();
  await claim(id, "worker-1");
  await finish(id, "worker-1", true);
  const again = await finish(id, "worker-1", true);
  check("a repeated finish reports the existing result", [again.ok, again.alreadyFinished], [true, true]);
  const { rows: [{ count }] } = await db.query("select count(*)::int from public.agent_action_events where action_id = $1 and next_status = 'execution_succeeded'", [id]);
  check("and does not double-audit", count, 1);
}

console.log("\n--- claims need an owner, and leases are bounded ---");
{
  const id = await makeAction();
  let error = null;
  try { await claim(id, "   "); } catch (caught) { error = caught; }
  checkRaises("an anonymous claim is refused", error, "needs an owner");
  await claim(id, "worker-1", 99999);
  const { rows: [{ secs }] } = await db.query("select extract(epoch from (lease_expires_at - now()))::int as secs from public.agent_actions where id = $1", [id]);
  check("an absurd lease is capped at an hour", secs <= 3600, true);
}
{
  let error = null;
  try { await claim("00000000-0000-0000-0000-000000000000", "worker-1"); } catch (caught) { error = caught; }
  checkRaises("an unknown action is refused", error, "no longer exists");
}

console.log("\n--- recovery leaves healthy work alone ---");
{
  const live = await makeAction();
  await claim(live, "worker-1", 600);
  const idle = await makeAction();
  const recovered = await recover();
  check("nothing is recovered when no lease has expired", recovered.recovered, 0);
  check("a running action keeps running", (await row(live)).execution_status, "running");
  check("an unclaimed action is untouched", (await row(idle)).execution_status, "not_started");
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
