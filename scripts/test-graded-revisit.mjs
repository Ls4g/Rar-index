import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role service_role;
  create role anon;
  create role authenticated;
  create schema if not exists public;
  create table public.scout_listing_leads (
    id uuid primary key, external_id text not null, review_status text not null,
    review_notes text, reviewed_by text, reviewed_at timestamptz,
    last_seen_at timestamptz not null, updated_at timestamptz not null
  );
  create table public.scout_lead_decisions (
    id uuid primary key default gen_random_uuid(), lead_id uuid not null,
    decision text not null, decision_notes text not null,
    reviewed_by text not null, created_at timestamptz not null default now()
  );
  create table public.scout_decision_labels (
    id uuid primary key default gen_random_uuid(), decision_id uuid not null,
    lead_id uuid not null, label text not null,
    created_at timestamptz not null default now()
  );
  create table public.listing_outcomes (external_id text not null, status text not null);
`);
await db.exec(readFileSync(new URL("../supabase/migrations/20261006_graded_scout_revisit.sql", import.meta.url), "utf8"));

const lead = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
for (const id of [lead, other]) {
  await db.query("insert into public.scout_listing_leads (id,external_id,review_status,review_notes,reviewed_by,last_seen_at,updated_at) values ($1,$2,'dismissed','Graded, not raw','SP','2026-09-01','2026-09-01')", [id, id]);
}
const old = await db.query("insert into public.scout_lead_decisions (lead_id,decision,decision_notes,reviewed_by) values ($1,'dismissed','Graded, not raw','SP') returning id", [lead]);
await db.query("insert into public.scout_decision_labels (lead_id,decision_id,label) values ($1,$2,'graded_not_raw')", [lead, old.rows[0].id]);

await assert.rejects(
  db.query("select public.revisit_graded_scout_lead($1,'watching','SP',null)", [other]),
  /no graded-copy dismissal/i,
);
const before = await db.query("select count(*)::int as count from public.scout_lead_decisions where lead_id=$1", [lead]);
assert.equal(before.rows[0].count, 1);

await db.query("select public.revisit_graded_scout_lead($1,'watching','SP','Original eBay page is live')", [lead]);
const current = await db.query("select review_status, review_notes, last_seen_at from public.scout_listing_leads where id=$1", [lead]);
assert.equal(current.rows[0].review_status, "watching");
assert.equal(current.rows[0].review_notes, "Original eBay page is live");
assert.ok(new Date(current.rows[0].last_seen_at).getTime() > new Date("2026-09-01").getTime());
const history = await db.query("select decision, decision_notes from public.scout_lead_decisions where lead_id=$1 order by created_at", [lead]);
assert.equal(history.rows.length, 2);
assert.deepEqual(new Set(history.rows.map((row) => row.decision)), new Set(["dismissed", "watching"]));
await assert.rejects(
  db.query("select public.revisit_graded_scout_lead($1,'watching','SP',null)", [lead]),
  /currently dismissed/i,
);

const archived = "33333333-3333-4333-8333-333333333333";
await db.query("insert into public.scout_listing_leads (id,external_id,review_status,last_seen_at,updated_at) values ($1,$2,'dismissed','2026-09-01','2026-09-01')", [archived, archived]);
const original = await db.query("insert into public.scout_lead_decisions (lead_id,decision,decision_notes,reviewed_by) values ($1,'dismissed','Graded, not raw','SP') returning id", [archived]);
await db.query("insert into public.scout_decision_labels (lead_id,decision_id,label) values ($1,$2,'graded_not_raw')", [archived, original.rows[0].id]);
await db.query("select public.revisit_graded_scout_lead($1,'dismissed','SP',null)", [archived]);
const archivedHistory = await db.query("select decision_notes from public.scout_lead_decisions where lead_id=$1", [archived]);
assert.equal(archivedHistory.rows.length, 2);
assert.ok(archivedHistory.rows.some((row) => row.decision_notes.includes("kept archived")));
await assert.rejects(
  db.query("select public.revisit_graded_scout_lead($1,'dismissed','SP',null)", [archived]),
  /already been revisited/i,
);

const concluded = "44444444-4444-4444-8444-444444444444";
await db.query("insert into public.scout_listing_leads (id,external_id,review_status,last_seen_at,updated_at) values ($1,$2,'dismissed','2026-09-01','2026-09-01')", [concluded, concluded]);
const concludedDecision = await db.query("insert into public.scout_lead_decisions (lead_id,decision,decision_notes,reviewed_by) values ($1,'dismissed','Graded, not raw','SP') returning id", [concluded]);
await db.query("insert into public.scout_decision_labels (lead_id,decision_id,label) values ($1,$2,'graded_not_raw')", [concluded, concludedDecision.rows[0].id]);
await db.query("insert into public.listing_outcomes (external_id,status) values ($1,'unsold')", [concluded]);
await assert.rejects(
  db.query("select public.revisit_graded_scout_lead($1,'watching','SP',null)", [concluded]),
  /already has a final outcome/i,
);
const concludedHistory = await db.query("select count(*)::int as count from public.scout_lead_decisions where lead_id=$1", [concluded]);
assert.equal(concludedHistory.rows[0].count, 1);

console.log("Graded re-review migration: labelled-only, audit-preserving, reopen, archive, final-outcome, and replay guards passed.");
await db.close();
