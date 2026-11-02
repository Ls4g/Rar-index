import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { galleryTheme } from "../lib/collectorGalleryTheme.ts";

const root = new URL("../", import.meta.url);
const sql = readFileSync(fileURLToPath(new URL("supabase/migrations/20261102_collector_premium_preview.sql", root)), "utf8");
const db = new PGlite();
await db.exec(`
  create schema auth;
  create role anon;
  create role authenticated;
  create table auth.users (id uuid primary key);
  create table public.collector_profiles (user_id uuid primary key references auth.users(id), username_key text not null);
  create table public.collector_gallery_layouts (user_id uuid primary key references public.collector_profiles(user_id), edition_ids uuid[] not null);
  insert into auth.users (id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
  insert into public.collector_profiles (user_id, username_key) values
    ('00000000-0000-0000-0000-000000000001', 'shamar'),
    ('00000000-0000-0000-0000-000000000002', 'another');
`);
await db.exec(sql);
await db.exec(sql); // Re-applying the saved migration must not fail or duplicate access.

const access = await db.query("select user_id from public.collector_premium_access");
assert.deepEqual(access.rows.map((row) => row.user_id), ["00000000-0000-0000-0000-000000000001"]);
await db.exec("set role authenticated");
await assert.rejects(db.exec("insert into public.collector_premium_access (user_id) values ('00000000-0000-0000-0000-000000000002')"), /permission denied/);
await db.exec("reset role");
await db.exec(`insert into public.collector_gallery_layouts (user_id, edition_ids) values
  ('00000000-0000-0000-0000-000000000001', '{}'),
  ('00000000-0000-0000-0000-000000000002', '{}');`);
await db.exec("update public.collector_gallery_layouts set gallery_theme='saffron', show_premium_badge=true where user_id='00000000-0000-0000-0000-000000000001'");
await assert.rejects(db.exec("update public.collector_gallery_layouts set gallery_theme='indigo' where user_id='00000000-0000-0000-0000-000000000002'"), /Premium gallery options require preview access/);
await assert.rejects(db.exec("update public.collector_gallery_layouts set show_premium_badge=true where user_id='00000000-0000-0000-0000-000000000002'"), /Premium gallery options require preview access/);
await assert.rejects(db.exec("update public.collector_gallery_layouts set gallery_theme='unknown' where user_id='00000000-0000-0000-0000-000000000001'"), /collector_gallery_theme_choice/);
assert.equal(galleryTheme("indigo"), "indigo");
assert.equal(galleryTheme("unknown"), "studio");
await db.close();
console.log("Collector Premium preview migration and theme checks passed.");
