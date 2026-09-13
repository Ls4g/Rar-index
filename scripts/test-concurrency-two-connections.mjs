// The one thing PGlite cannot establish: what two simultaneous database
// sessions do to each other.
//
//   node --experimental-strip-types scripts/test-concurrency-two-connections.mjs
//
// PGlite runs a single backend, so `select ... for update` never actually
// blocks a second session there -- the lock is taken and released inside the
// same backend and the race the lock exists to prevent cannot be staged. Every
// atomicity claim made so far (test-outcome-sale-atomicity.mjs, 59 checks, and
// test-agent-execution-leases.mjs, 48) is about rollback, idempotency and
// refusal paths. None of it proves that a second concurrent confirmation
// blocks rather than interleaving.
//
// This script needs a real PostgreSQL server with two independent connections.
// It applies the shipped migrations to a scratch database of its own and works
// only on rows it created. It must never be pointed at production: see the
// refusal below.
//
// STATUS: never executed. No PostgreSQL server, Docker, or psql exists on the
// machine this was written on, and .env.local carries no database password, so
// the scenarios below are unrun. Do not read a passing run of the other suites
// as covering them.
//
// SETUP
//   1. A server. Either:
//        docker run -d --name rar-pg -e POSTGRES_PASSWORD=test \
//          -e POSTGRES_DB=rar_concurrency -p 5433:5432 postgres:18
//      or any reachable PostgreSQL 18 instance and an empty database on it.
//   2. pnpm add -D pg
//   3. RAR_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5433/rar_concurrency
//   4. Run the command above.

import { readFile } from "node:fs/promises";

const url = process.env.RAR_TEST_DATABASE_URL;

function blocked(reason) {
  console.log(`\nBLOCKED — not run. ${reason}\n`);
  console.log("Still unproven, and only a real two-connection server can prove it:");
  for (const item of SCENARIOS) console.log(`  - ${item}`);
  console.log("\nSee the header of this file for the exact setup.\n");
  process.exit(0);
}

const SCENARIOS = [
  "two simultaneous confirm_outcome_sale calls on one outcome produce exactly one sale, and the loser is told why",
  "a confirmation racing a dismissal leaves the outcome and the sale agreeing with each other, whichever wins",
  "a retry after a winner has committed reuses that sale rather than creating a second",
  "a failure inside the transaction leaves no observation, no audit row and no closed outcome",
  "two workers claiming one agent action produce one owner, and lease recovery does not hand a live action to a second",
];

// PostgreSQL is required. The migrations below are the shipped files, unedited.
const MIGRATIONS = [
  "supabase/migrations/20260913_atomic_outcome_sale_closure.sql",
  "supabase/migrations/20260913_observation_grading_correction.sql",
  "supabase/migrations/20260913_durable_agent_execution.sql",
];

if (!url) blocked("RAR_TEST_DATABASE_URL is not set.");

// Refuse production outright. A concurrency fixture writes sales and agent
// actions, and this file exists to be run against a throwaway database.
if (/supabase\.(co|com)|fmzzersppzqevtwqvnbd|pooler\.supabase/i.test(url)) {
  console.error("\nRefusing to run: RAR_TEST_DATABASE_URL points at Supabase.");
  console.error("This creates and races sale evidence. Point it at a scratch database.\n");
  process.exit(1);
}

let pg;
try {
  pg = await import("pg");
} catch {
  blocked("The 'pg' package is not installed (pnpm add -D pg).");
}

const { Client } = pg.default ?? pg;

async function connect(label) {
  const client = new Client({ connectionString: url, application_name: `rar-concurrency-${label}` });
  await client.connect();
  return client;
}

let checks = 0;
let failures = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) { console.log(`  ok   ${label}`); return true; }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

const setup = await connect("setup");
console.log(`\nServer: ${(await setup.query("select version()")).rows[0].version.split(" ").slice(0, 2).join(" ")}`);

// Two genuinely separate backends, or there is no point continuing.
const left = await connect("left");
const right = await connect("right");
const pids = [
  (await left.query("select pg_backend_pid() as pid")).rows[0].pid,
  (await right.query("select pg_backend_pid() as pid")).rows[0].pid,
];
if (pids[0] === pids[1]) {
  console.error(`\nBoth connections share backend pid ${pids[0]}. This is not two sessions; the results would mean nothing.\n`);
  process.exit(1);
}
console.log(`Two backends: ${pids.join(" and ")}`);

console.log("\nApplying the shipped migrations to the scratch database");
for (const path of MIGRATIONS) {
  const sql = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  await setup.query(sql);
  console.log(`  applied ${path.split("/").pop()}`);
}

/**
 * Hold a row lock on one connection, then time how long the other waits for
 * it. A lock that is really held makes the second call wait; a single-backend
 * fake returns immediately, which is exactly what this is here to detect.
 */
async function provesBlocking(lockSql, contendSql) {
  await left.query("begin");
  await left.query(lockSql);
  const started = Date.now();
  const contended = right.query(contendSql);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const finishedEarly = await Promise.race([contended.then(() => true), Promise.resolve(false)]);
  await left.query("commit");
  await contended.catch(() => {});
  return { blocked: !finishedEarly, waitedMs: Date.now() - started };
}

console.log("\n0. The lock this all depends on really blocks a second session");
await setup.query("create table if not exists rar_lock_probe (id int primary key, n int)");
await setup.query("insert into rar_lock_probe values (1, 0) on conflict (id) do update set n = 0");
const probe = await provesBlocking(
  "select * from rar_lock_probe where id = 1 for update",
  "select * from rar_lock_probe where id = 1 for update",
);
check("a second session waits for a held row lock", probe.blocked, `returned after ${probe.waitedMs}ms without waiting`);
await setup.query("drop table if exists rar_lock_probe");

if (!probe.blocked) {
  console.error("\nThe server did not block. Everything below would be meaningless; stopping.\n");
  process.exit(1);
}

console.log("\nThe five scenarios still need fixtures building against this schema:");
for (const item of SCENARIOS) console.log(`  todo  ${item}`);
console.log("\nThe fixture builder is not written, because it cannot be developed against a");
console.log("server that does not exist here. What this script establishes today is the");
console.log("harness: two real backends, the shipped migrations applied, and a proven row");
console.log("lock. Build the fixtures on a machine where it runs, and do not mark");
console.log("concurrency proven until every scenario above prints ok.\n");

await left.end();
await right.end();
await setup.end();
console.log(`${failures ? "FAILED" : "HARNESS OK"}: ${checks - failures}/${checks} checks, ${SCENARIOS.length} scenarios still to build\n`);
process.exit(failures ? 1 : 0);
