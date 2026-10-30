import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role service_role;
  create schema if not exists public;
  create table public.manga_editions (
    id uuid primary key, cover_image_url text, cover_source_url text,
    cover_source_name text, cover_verification_status text,
    cover_verified_at timestamptz, updated_at timestamptz
  );
  create table public.cover_candidates (
    id uuid primary key, edition_id uuid not null, status text not null,
    cover_image_url text not null, source_record_url text not null,
    source_name text not null, reviewed_at timestamptz,
    reviewed_by text, review_notes text
  );
  create table public.cover_review_decisions (
    id uuid primary key default gen_random_uuid(), edition_id uuid not null,
    previous_status text, decision text, cover_image_url text,
    cover_source_url text, cover_source_name text,
    decision_notes text, reviewed_by text
  );
  create table public.cover_candidate_decisions (
    id uuid primary key default gen_random_uuid(), candidate_id uuid not null,
    edition_id uuid not null, decision text, decision_notes text,
    reviewed_by text
  );
`);
await db.exec(readFileSync(new URL("../supabase/migrations/20261030_replace_verified_cover_from_candidate.sql", import.meta.url), "utf8"));

const edition = "11111111-1111-4111-8111-111111111111";
const candidate = "22222222-2222-4222-8222-222222222222";
const otherEdition = "33333333-3333-4333-8333-333333333333";
const oldImage = "https://covers.openlibrary.org/old.jpg";
const oldSource = "https://openlibrary.org/books/old";
const newImage = "https://www.viz.com/new.jpg";
const newSource = "https://www.viz.com/manga-books/new";
await db.query("insert into public.manga_editions (id,cover_image_url,cover_source_url,cover_source_name,cover_verification_status) values ($1,$2,$3,'Open Library','verified'),($4,null,null,null,'missing')", [edition, oldImage, oldSource, otherEdition]);
await db.query("insert into public.cover_candidates (id,edition_id,status,cover_image_url,source_record_url,source_name) values ($1,$2,'pending',$3,$4,'VIZ Media')", [candidate, edition, newImage, newSource]);

async function replace(id = candidate, editionId = edition, expectedImage = oldImage, expectedSource = oldSource, reviewer = "SP") {
  return db.query("select public.replace_verified_cover_from_candidate($1,$2,$3,$4,$5)", [id, editionId, expectedImage, expectedSource, reviewer]);
}

await assert.rejects(replace(candidate, otherEdition), /does not belong/i);
await assert.rejects(replace(candidate, edition, "https://stale.example/cover.jpg"), /cover changed/i);
await assert.rejects(replace(candidate, edition, oldImage, oldSource, " "), /reviewer is required/i);
assert.equal((await db.query("select status from public.cover_candidates where id=$1", [candidate])).rows[0].status, "pending");

await replace();
const current = (await db.query("select cover_image_url,cover_source_url,cover_source_name,cover_verification_status from public.manga_editions where id=$1", [edition])).rows[0];
assert.deepEqual(current, { cover_image_url: newImage, cover_source_url: newSource, cover_source_name: "VIZ Media", cover_verification_status: "verified" });
assert.equal((await db.query("select status from public.cover_candidates where id=$1", [candidate])).rows[0].status, "approved");
const history = (await db.query("select previous_cover_image_url,previous_cover_source_url,cover_image_url,reviewed_by from public.cover_review_decisions where edition_id=$1", [edition])).rows;
assert.equal(history.length, 1);
assert.deepEqual(history[0], { previous_cover_image_url: oldImage, previous_cover_source_url: oldSource, cover_image_url: newImage, reviewed_by: "SP" });
assert.equal((await db.query("select count(*)::int as count from public.cover_candidate_decisions where candidate_id=$1", [candidate])).rows[0].count, 1);
await assert.rejects(replace(), /already has a human decision/i);

console.log("cover replacement: exact edition, stale-cover guard, single human decision, and old/new provenance passed");
await db.close();
