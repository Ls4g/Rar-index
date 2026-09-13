// Correcting the grading on a verified sale, against a real PostgreSQL engine.
//
//   node scripts/test-observation-grading.mjs
//
// Runs the shipped migration SQL inside PGlite. The rule under test is that a
// listing title is a conflict SIGNAL and never proof: nothing here may write a
// grade that a human did not state after opening the original listing, and
// nothing may rewrite grading a human has already settled.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { hasUnresolvedGrading, isRawValuationEvidence } from "../lib/gradingEvidence.ts";

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

// The production title from the audit, kept verbatim. Anything that stops
// recognising this exact string would silently re-pool a USD 2000 graded slab
// with USD 42-149 raw copies.
const BGS_TITLE = "Hunter x Hunter #1 ⭐ BGS 8.5 - 1ST PRINTING ⭐ Japanese Manga 1998 US SELLER";
const RAW_TITLE = "HUNTER × HUNTER Vol.1 First 1st Print edition Japanese Comic";

console.log("\n--- which sales the calculations withhold ---");
check("the real BGS-titled sale with no grade is unresolved",
  hasUnresolvedGrading({ listing_title: BGS_TITLE, grading_company: null, grade_label: null }), true);
check("and is therefore not raw evidence",
  isRawValuationEvidence({ listing_title: BGS_TITLE, grading_company: null, grade_label: null }), false);
check("a genuinely raw sibling is still raw evidence",
  isRawValuationEvidence({ listing_title: RAW_TITLE, grading_company: null, grade_label: null }), true);
check("half a grade is unresolved (company only)",
  hasUnresolvedGrading({ listing_title: RAW_TITLE, grading_company: "CGC", grade_label: null }), true);
check("half a grade is unresolved (grade only)",
  hasUnresolvedGrading({ listing_title: RAW_TITLE, grading_company: null, grade_label: "9.8" }), true);
check("a complete grade is resolved",
  hasUnresolvedGrading({ listing_title: BGS_TITLE, grading_company: "BGS", grade_label: "8.5" }), false);
check("a complete grade is not raw evidence",
  isRawValuationEvidence({ listing_title: BGS_TITLE, grading_company: "BGS", grade_label: "8.5" }), false);
// The case that had no way out before: a title mentioning grading on a copy
// that is genuinely raw. Without a human's answer being recorded it would stay
// withheld for ever.
check("a human's 'it is raw' answer settles a graded-sounding title",
  hasUnresolvedGrading({ listing_title: BGS_TITLE, grading_company: null, grade_label: null, grading_reviewed_at: "2026-09-13T00:00:00Z" }), false);
check("and it counts as raw evidence again",
  isRawValuationEvidence({ listing_title: BGS_TITLE, grading_company: null, grade_label: null, grading_reviewed_at: "2026-09-13T00:00:00Z" }), true);
// A review must never rescue a half-recorded grade -- that is incomplete on its
// face regardless of who looked.
check("a settled review cannot rescue half a grade",
  hasUnresolvedGrading({ listing_title: RAW_TITLE, grading_company: "CGC", grade_label: null, grading_reviewed_at: "2026-09-13T00:00:00Z" }), true);

const db = await new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create or replace function public.block_agent_reliability_mutation() returns trigger
  language plpgsql as $$ begin raise exception 'append only'; end; $$;
  create table public.manga_editions (id uuid primary key default gen_random_uuid());
  create table public.sources (id uuid primary key default gen_random_uuid());
  create table public.price_observations (
    id uuid primary key default gen_random_uuid(),
    edition_id uuid not null references public.manga_editions(id),
    source_id uuid not null references public.sources(id),
    source_listing_url text not null, external_id text, listing_title text not null,
    sold_date date, sale_price numeric, currency text,
    grading_company text, grade_label text,
    is_verified boolean not null default true, match_status text default 'verified_match',
    sale_status text default 'confirmed', reviewed_by text
  );
  create table public.agent_human_feedback (
    id uuid primary key default gen_random_uuid(),
    workflow text not null, subject_key text not null, outcome text not null,
    reason_label text, note text, reviewed_by text not null,
    created_at timestamptz not null default now()
  );
`);
await db.exec(readFileSync(new URL("../supabase/migrations/20260913_observation_grading_correction.sql", import.meta.url), "utf8"));
console.log("\nloaded shipped migration: observation_grading_correction");

const { rows: [{ id: editionId }] } = await db.query("insert into public.manga_editions default values returning id");
const { rows: [{ id: sourceId }] } = await db.query("insert into public.sources default values returning id");

let n = 0;
async function makeSale(overrides = {}) {
  n += 1;
  const row = { listing_title: BGS_TITLE, grading_company: null, grade_label: null, ...overrides };
  const { rows: [{ id }] } = await db.query(
    `insert into public.price_observations (edition_id, source_id, source_listing_url, external_id, listing_title, sold_date, sale_price, currency, grading_company, grade_label)
     values ($1,$2,$3,$4,$5,'2026-08-20',2000,'USD',$6,$7) returning id`,
    [editionId, sourceId, `https://www.ebay.com/itm/15811707868${n}`, String(15811707868 + n), row.listing_title, row.grading_company, row.grade_label]);
  return id;
}
async function correct(id, options = {}) {
  const args = { copyType: "graded", company: "BGS", grade: "8.5", confirmed: true, notes: null, reviewer: "SP", ...options };
  const { rows } = await db.query(
    "select public.record_observation_grading($1,$2,$3,$4,$5,$6,$7) as result",
    [id, args.copyType, args.company, args.grade, args.confirmed, args.notes, args.reviewer]);
  return rows[0].result;
}
async function saleRow(id) {
  const { rows: [row] } = await db.query(
    "select grading_company, grade_label, grading_reviewed_by, grading_review_notes, is_verified, match_status from public.price_observations where id = $1", [id]);
  return row;
}
async function auditCount() {
  const { rows: [row] } = await db.query(`select
    (select count(*)::int from public.price_grading_decisions) as decisions,
    (select count(*)::int from public.agent_human_feedback) as feedback`);
  return row;
}

console.log("\n--- a human records what the slab says ---");
{
  const id = await makeSale();
  const before = await auditCount();
  const result = await correct(id, { notes: "Opened the listing; BGS slab photographed front and back." });
  const row = await saleRow(id);
  check("the grade is stored exactly as stated", [row.grading_company, row.grade_label], ["BGS", "8.5"]);
  check("the reviewer is recorded", row.grading_reviewed_by, "SP");
  check("the sale's own verification is untouched", [row.is_verified, row.match_status], [true, "verified_match"]);
  check("the correction is audited", (await auditCount()).decisions - before.decisions, 1);
  check("and fed back to the agents", (await auditCount()).feedback - before.feedback, 1);
  check("the result names the copy type", [result.copyType, result.gradingCompany], ["graded", "BGS"]);
  const { rows: [audit] } = await db.query("select previous_grading_company, previous_grade_label, listing_title from public.price_grading_decisions where observation_id = $1", [id]);
  check("the audit keeps what the sale said before", [audit.previous_grading_company, audit.previous_grade_label], [null, null]);
}

console.log("\n--- or that there was no slab at all ---");
{
  const id = await makeSale();
  await correct(id, { copyType: "raw", company: null, grade: null });
  const row = await saleRow(id);
  check("no grade is invented", [row.grading_company, row.grade_label], [null, null]);
  check("but the human's look is recorded", row.grading_reviewed_by, "SP");
  const { rows: [r] } = await db.query("select grading_reviewed_at from public.price_observations where id = $1", [id]);
  check("so the sale is raw evidence again",
    isRawValuationEvidence({ listing_title: BGS_TITLE, grading_company: null, grade_label: null, grading_reviewed_at: r.grading_reviewed_at }), true);
}

console.log("\n--- a grade is never taken from a title ---");
{
  const id = await makeSale();
  let error = null;
  try { await correct(id, { confirmed: false }); } catch (caught) { error = caught; }
  checkRaises("without confirming they opened the source, nothing is written", error, "opened the original listing");
  check("the sale is unchanged", await saleRow(id), { grading_company: null, grade_label: null, grading_reviewed_by: null, grading_review_notes: null, is_verified: true, match_status: "verified_match" });
}
{
  const id = await makeSale();
  let error = null;
  try { await correct(id, { grade: null }); } catch (caught) { error = caught; }
  checkRaises("a graded copy needs both company and grade", error, "both the grading company and the exact grade");
  check("nothing was written", (await saleRow(id)).grading_reviewed_by, null);
}
{
  const id = await makeSale();
  let error = null;
  try { await correct(id, { copyType: "raw" }); } catch (caught) { error = caught; }
  checkRaises("a raw copy cannot carry a grade", error, "cannot carry a grading company");
}
{
  const id = await makeSale();
  let error = null;
  try { await correct(id, { reviewer: "  " }); } catch (caught) { error = caught; }
  checkRaises("an anonymous correction is refused", error, "name or initials");
}
{
  const id = await makeSale();
  let error = null;
  try { await correct(id, { copyType: "probably graded" }); } catch (caught) { error = caught; }
  checkRaises("a vague copy type is refused", error, "raw or graded");
}

console.log("\n--- settled evidence is not rewritten here ---");
{
  const id = await makeSale();
  await correct(id);
  const before = await auditCount();
  let error = null;
  try { await correct(id, { company: "CGC", grade: "9.8" }); } catch (caught) { error = caught; }
  checkRaises("a second correction is refused by name", error, "already settled by SP");
  check("the first answer stands", [(await saleRow(id)).grading_company, (await saleRow(id)).grade_label], ["BGS", "8.5"]);
  check("and no audit row was added", (await auditCount()).decisions - before.decisions, 0);
}
{
  const id = await makeSale({ grading_company: "CGC", grade_label: "9.6" });
  let error = null;
  try { await correct(id); } catch (caught) { error = caught; }
  checkRaises("a sale with a complete grade is sent to sale review instead", error, "already records a complete grade");
  check("its grade is untouched", [(await saleRow(id)).grading_company, (await saleRow(id)).grade_label], ["CGC", "9.6"]);
}
{
  // Half a grade IS in scope -- it is exactly the contradiction this resolves.
  const id = await makeSale({ grading_company: "CGC", grade_label: null });
  await correct(id, { company: "CGC", grade: "9.6" });
  check("half a grade can be completed", [(await saleRow(id)).grading_company, (await saleRow(id)).grade_label], ["CGC", "9.6"]);
  const { rows: [audit] } = await db.query("select previous_grading_company, previous_grade_label from public.price_grading_decisions where observation_id = $1", [id]);
  check("and the audit records the half it replaced", [audit.previous_grading_company, audit.previous_grade_label], ["CGC", null]);
}

console.log("\n--- the audit trail cannot be edited away ---");
{
  const id = await makeSale();
  await correct(id);
  let error = null;
  try { await db.query("update public.price_grading_decisions set grade_label = '9.9' where observation_id = $1", [id]); } catch (caught) { error = caught; }
  checkRaises("a correction record cannot be updated", error, "append only");
  error = null;
  try { await db.query("delete from public.price_grading_decisions where observation_id = $1", [id]); } catch (caught) { error = caught; }
  checkRaises("nor deleted", error, "append only");
}

console.log("\n--- a missing sale is refused, not created ---");
{
  let error = null;
  try { await correct("00000000-0000-0000-0000-000000000000"); } catch (caught) { error = caught; }
  checkRaises("an unknown sale is refused", error, "no longer exists");
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
