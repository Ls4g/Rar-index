import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { runRecordedCron, summarizeCronResponse } from "../lib/cronHeartbeat.ts";

const writes = [];
const events = [];
let fail = "";
const admin = { from(table) {
  assert.equal(table, "cron_invocations");
  const operation = (stage, data) => ({
    eq(key, value) { assert.equal(key, "id"); assert.ok(value); return this; },
    async abortSignal(signal) {
      assert.ok(signal instanceof AbortSignal);
      events.push(stage);
      if (stage === fail) return { error: { message: "private diagnostic" } };
      writes.push({ stage, ...data });
      return { error: null };
    },
  });
  return { insert: (data) => operation("start", data), update: (data) => operation("finish", data) };
} };
const logs = [];
const original = { info: console.info, error: console.error };
console.info = console.error = (message) => logs.push(message);
try {
  const response = await runRecordedCron("portfolio-snapshots", () => admin, async () => {
    events.push("work");
    return Response.json({ usersChecked: 1, created: 0, skipped: 1, failed: 0, password: "private diagnostic" });
  });
  assert.deepEqual(events, ["start", "work", "finish"]);
  assert.equal(writes[0].status, "started");
  assert.equal(writes[1].status, "completed");
  assert.equal(writes[1].summary.skipped, 1, "unchanged portfolio is a recorded success");
  assert.equal(response.headers.get("X-RAR-Cron-Recorded"), "true");
  assert.equal(response.headers.get("X-RAR-Cron-Run"), writes[0].id);
  assert.equal(JSON.stringify(writes).includes("private diagnostic"), false);
  for (const stage of ["start", "finish"]) {
    fail = stage;
    let worked = false;
    const result = await runRecordedCron("ebay-scout", () => admin, async () => {
      worked = true;
      return Response.json({ failures: 0 });
    });
    assert.equal(worked, true, "audit outage must not disable work");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("X-RAR-Cron-Recorded"), "false");
  }
  fail = "";
  const thrown = await runRecordedCron("listing-outcomes", () => admin, async () => { throw Error("private diagnostic"); });
  assert.equal(thrown.status, 500);
  assert.equal(writes.at(-1).status, "failed");
  assert.equal((await thrown.text()).includes("private diagnostic"), false);
  const noAdmin = await runRecordedCron("rar-agents", () => { throw Error("private diagnostic"); }, async () => assert.fail());
  assert.equal(noAdmin.status, 500);
  assert.equal(noAdmin.headers.get("X-RAR-Cron-Recorded"), "false");
  assert.equal(logs.join("").includes("private diagnostic"), false);
} finally { Object.assign(console, original); }

assert.equal(summarizeCronResponse("listing-outcomes", 200, { checks: { budgetUnavailable: true } }).status, "failed");
assert.equal(summarizeCronResponse("listing-outcomes", 200, { checks: { errors: ["secret"] } }).status, "partial");
assert.equal(summarizeCronResponse("listing-outcomes", 200, { checks: { ceilingReached: true } }).status, "completed");
assert.equal(summarizeCronResponse("portfolio-snapshots", 200, { failed: 1 }).status, "partial");
assert.equal(summarizeCronResponse("ebay-scout", 200, { failures: 1 }).status, "partial");
assert.equal(summarizeCronResponse("rar-agents", 207, { cycle: { blocked: 1 } }).status, "partial");
assert.equal(summarizeCronResponse("agent-reliability", 200, { result: { runs: [{ passed: false }] } }).status, "partial");

// Execute actual handlers with inert dependencies: auth must precede both audit
// and work. No environment credentials, real database or providers are used.
const names = ["ebay-scout", "portfolio-snapshots", "rar-agents", "agent-reliability", "listing-outcomes"];
for (const name of names) {
  let calls = 0;
  const exports = {};
  const source = readFileSync(new URL(`../app/api/cron/${name}/route.ts`, import.meta.url), "utf8");
  const context = { exports, Request, Response, URL, process: { env: { CRON_SECRET: "test-only" } }, require(path) {
    if (path.endsWith("cronHeartbeat")) return { runRecordedCron: async (_name, _factory, work) => {
      calls++;
      return name === "listing-outcomes" ? work({}) : Response.json({ test: true });
    } };
    if (path.endsWith("watchToSale")) return {
      captureWatchedListings: async () => ({ captured: 0 }), promoteEndedListings: async () => 0,
      runOutcomeChecks: async () => ({ budgetUnavailable: true, errors: ["Unavailable"] }),
    };
    return {};
  } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  for (const authorization of [undefined, "Bearer wrong"]) {
    assert.equal((await exports.GET(new Request("https://example.invalid/api/cron/" + name, { headers: authorization ? { authorization } : {} }))).status, 401);
  }
  assert.equal(calls, 0);
  const result = await exports.GET(new Request("https://example.invalid/api/cron/" + name, { headers: { authorization: "Bearer test-only" } }));
  assert.equal(calls, 1);
  if (name === "listing-outcomes") {
    assert.equal(result.status, 503);
    assert.equal((await result.json()).ok, false);
  }
}

const db = new PGlite();
await db.exec("create role anon; create role authenticated; create role service_role;");
await db.exec(readFileSync(new URL("../supabase/migrations/20260930_cron_invocations.sql", import.meta.url), "utf8"));
for (const role of ["anon", "authenticated"]) {
  assert.equal((await db.query(`select has_table_privilege('${role}', 'cron_invocations', 'select') as allowed`)).rows[0].allowed, false);
}
assert.equal((await db.query("select relrowsecurity from pg_class where relname='cron_invocations'")).rows[0].relrowsecurity, true);
assert.equal((await db.query("select has_table_privilege('service_role', 'cron_invocations', 'insert,update,select') as allowed")).rows[0].allowed, true);
await db.query("insert into cron_invocations(id,route,status) values($1,'/api/cron/listing-outcomes','started')", [crypto.randomUUID()]);
await assert.rejects(db.query("insert into cron_invocations(id,route,status) values($1,'/api/cron/listing-outcomes','completed')", [crypto.randomUUID()]), /check constraint/);
await db.close();
console.log("Cron heartbeat: lifecycle, no-op, partial failures, audit outages, privacy, route authorization and schema checks passed (single session).");
