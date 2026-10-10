import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Single-session transactional behavior only; not a concurrency test.
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table agent_actions (
    id uuid primary key default gen_random_uuid(), status text default 'approved',
    title text default 'Test action', review_notes text default 'Original approval',
    reviewed_by text default 'SP', reviewed_at timestamptz default '2026-09-01',
    executed_at timestamptz, created_at timestamptz default now(), action_type text default 'scan_stale_profiles'
  );
  create table agent_action_events (
    id bigint generated always as identity, action_id uuid references agent_actions,
    previous_status text, next_status text, actor text, notes text, details jsonb
  );
`);
for (const file of ["20260913_durable_agent_execution.sql", "20260924_atomic_agent_action_closure.sql"]) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
}
const make = async () => (await db.query("insert into agent_actions default values returning id")).rows[0].id;
const close = (id, reason = "Finished elsewhere") => db.query("select close_agent_action($1,'SP',$2)", [id, reason]);
const row = async (id) => (await db.query("select * from agent_actions where id=$1", [id])).rows[0];
const id = await make();
const before = await row(id);
await close(id);
const after = await row(id);
assert.equal(after.status, "cancelled");
assert.equal(after.reviewed_by, before.reviewed_by);
assert.deepEqual(after.reviewed_at, before.reviewed_at);
assert.match(after.review_notes, /^Original approval.*Closed by SP/);
assert.equal((await db.query("select * from agent_action_events where action_id=$1", [id])).rows.length, 1);
await assert.rejects(close(id), /not an open approval/);
const invalid = await make();
await assert.rejects(close(invalid, ""), /reason/);
await db.query("update agent_actions set status='proposed' where id=$1", [invalid]);
await assert.rejects(close(invalid), /not an open approval/);
const claimed = await make();
await db.query("select claim_agent_action($1,'attempt-1',30)", [claimed]);
await assert.rejects(close(claimed), /execution claim/);
await db.query("update agent_actions set lease_expires_at=now()-interval '1 minute' where id=$1", [claimed]);
await assert.rejects(close(claimed), /execution claim/);
await db.query("select recover_expired_agent_action_leases()");
await close(claimed);
await assert.rejects(db.query("select finish_agent_action($1,'attempt-1',true)", [claimed]), /not currently running/);
const rollback = await make();
await db.exec(`create function fail_close_audit() returns trigger language plpgsql as $$ begin
  if new.next_status='cancelled' then raise exception 'audit failure'; end if; return new; end; $$;
  create trigger fail_audit before insert on agent_action_events for each row execute function fail_close_audit();`);
await assert.rejects(close(rollback), /audit failure/);
assert.equal((await row(rollback)).status, "approved", "audit failure rolls back closure");
assert.equal((await row(rollback)).review_notes, "Original approval");
for (const role of ["anon", "authenticated"]) {
  assert.equal((await db.query("select has_function_privilege($1,'close_agent_action(uuid,text,text)','execute') as allowed", [role])).rows[0].allowed, false);
}
await db.close();
console.log("Atomic approval closure: refusal, recovery, audit rollback and permissions passed (single session).");
