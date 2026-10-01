import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Isolated PostgreSQL ACL/RLS behavior, never production and never concurrency.
const directory = new URL("../supabase/migrations/", import.meta.url);
const read = (name) => readFileSync(new URL(name, directory), "utf8");
const db = new PGlite();
const roleQuery = async (role, sql) => {
  await db.exec(`set role ${role}`);
  try { return await db.query(sql); } finally { await db.exec("reset role"); }
};
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges grant execute on functions to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
  create table manga (id bigint primary key, title text);
  insert into manga values (1, 'Legacy fixture');
  create table manga_editions (
    id uuid primary key, title text, series text, volume_number text, author text,
    publisher text, language text, isbn_13 text, release_date date, format text,
    edition_statement text, printing_number integer, variant_name text, collectible_type text,
    created_at timestamptz default now(), is_verified boolean, record_kind text,
    printing_of_edition_id uuid, cover_verification_status text
  );
  create table sources (id uuid primary key, name text);
  create table edition_sources (id uuid primary key, edition_id uuid, secret_payload text);
  create table marketplace_search_profiles (id uuid primary key, edition_id uuid, is_active boolean);
  create table marketplace_collection_runs (id uuid primary key, profile_id uuid);
  create table scout_scans (id uuid primary key, profile_id uuid, status text, scanned_at timestamptz);
  create table scout_listing_leads (
    id uuid primary key, profile_id uuid, review_status text, last_seen_at timestamptz, item_end_at timestamptz
  );
  create table price_observations (
    id uuid primary key, edition_id uuid, source_id uuid, match_status text, sale_status text,
    print_classification text, is_verified boolean default false, reviewed_at timestamptz,
    reviewed_by text, notes text, updated_at timestamptz, listing_title text,
    source_listing_url text, sold_date date, sale_price numeric, currency text,
    item_condition text, is_sealed boolean, created_at timestamptz default now(), raw_payload jsonb
  );
  create table price_review_decisions (observation_id uuid, decision text, decision_notes text, reviewed_by text);
  create table collector_profiles (user_id uuid primary key, username text, username_key text);
  create table portfolio_holdings (
    user_id uuid, edition_id uuid, purchase_price numeric, purchase_currency text,
    purchase_date date, notes text, quantity integer
  );
`);
// Exercise all historical project routine names independently of the repair's
// allowlist. Dummy bodies isolate ACL coverage; the real review/trigger bodies
// below additionally prove that denial prevents evidence mutation.
const routineNames = new Set(readdirSync(directory).filter((name) => name.endsWith(".sql"))
  .flatMap((name) => [...read(name).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)].map((match) => match[1])));
for (const name of routineNames) {
  if (name === "reject_reserved_collector_username") continue;
  await db.exec(`create function public.${name}() returns text language sql security definer as $$ select 'fixture'::text $$;`);
}
const realReview = read("20260810_streamline_price_review_notes_and_print_queue.sql")
  .match(/create or replace function public\.apply_price_review\([\s\S]*?\$\$;/i)[0];
await db.exec(realReview);
await db.exec(read("20260811_fix_collector_username_reserved_check.sql"));
await db.exec(`create trigger collector_username_guard before insert or update on collector_profiles
  for each row execute function reject_reserved_collector_username();
  create function unrelated_public_rpc() returns integer language sql as $$ select 7 $$;
  grant execute on all functions in schema public to public, anon, authenticated;
`);
await db.exec(read("20260815_public_shelf.sql"));
await db.exec(read("20260731_create_alpha_catalogue_view.sql"));
await db.exec(read("20260815_publication_availability.sql"));
const printView = read("20260809_publication_print_run_model.sql")
  .match(/create or replace view public\.publication_print_readiness[\s\S]*?grant select on public\.publication_print_readiness to anon, authenticated;/i)[0];
await db.exec(printView);
await db.exec(read("20260804_edition_readiness_coverage_columns.sql"));
await db.exec(read("20260821_quick_sale_evidence_reference.sql"));
await db.exec(`
  grant all on all tables in schema public to anon, authenticated, service_role;
  alter table portfolio_holdings enable row level security;
  create policy fixture_holdings_owner on portfolio_holdings for select to authenticated
    using (user_id = nullif(current_setting('rar.fixture_user', true),'')::uuid);
  alter table collector_profiles enable row level security;
  create policy fixture_profile_read on collector_profiles for select using (true);
  create policy fixture_profile_owner on collector_profiles for insert to authenticated
    with check (user_id = nullif(current_setting('rar.fixture_user', true),'')::uuid);
  alter table edition_sources enable row level security;
  alter table price_review_decisions enable row level security;
  alter table price_observations enable row level security;
  insert into manga_editions (id,title,publisher,isbn_13,release_date,is_verified,record_kind)
    values ('00000000-0000-0000-0000-000000000001','Verified fixture','Fixture publisher','fixture-isbn','2026-01-01',true,'publication'),
    ('00000000-0000-0000-0000-000000000002','Unreviewed fixture','Fixture publisher','fixture-2','2026-01-01',false,'publication');
  insert into edition_sources values
    (gen_random_uuid(),'00000000-0000-0000-0000-000000000001','private raw evidence'),
    (gen_random_uuid(),'00000000-0000-0000-0000-000000000002','private raw evidence');
  insert into sources values ('00000000-0000-0000-0000-000000000001','fixture');
  insert into price_observations (id,edition_id,source_id,match_status,sale_status,print_classification)
    values ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000001','needs_review','confirmed','first_print_proven');
  insert into collector_profiles values
    ('00000000-0000-0000-0000-000000000021','PublicCollector','publiccollector',true),
    ('00000000-0000-0000-0000-000000000022','PrivateCollector','privatecollector',false);
  insert into portfolio_holdings (user_id,edition_id,purchase_price,notes,quantity)
    select user_id,'00000000-0000-0000-0000-000000000001',99,'private note',7 from collector_profiles;
  insert into marketplace_search_profiles values
    ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001',true);
  insert into scout_scans values (gen_random_uuid(),'00000000-0000-0000-0000-000000000031','completed',now());
  insert into scout_listing_leads values (gen_random_uuid(),'00000000-0000-0000-0000-000000000031','new',now(),null);
  select set_config('rar.fixture_user','00000000-0000-0000-0000-000000000023',false);
`);
for (const name of ["20260930_staff_rpc_permissions.sql", "20260930_review_view_permissions.sql", "20260930_legacy_manga_permissions.sql"]) {
  await db.exec(read(name));
  await db.exec(read(name)); // Safe reapplication, no feature/data migration dependency.
}
for (const name of routineNames) {
  const { rows } = await db.query(`select oid::regprocedure::text as signature from pg_proc
    where pronamespace='public'::regnamespace and proname=$1`, [name]);
  for (const { signature } of rows) {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const result = await db.query("select has_function_privilege($1,$2,'execute') as allowed", [role, signature]);
      assert.equal(result.rows[0].allowed, role === "service_role", `${role}: ${signature}`);
    }
  }
}
const reviewCall = `select apply_price_review('00000000-0000-0000-0000-000000000011'::uuid,'verified_match','','Synthetic staff')`;
for (const role of ["anon", "authenticated"]) {
  await assert.rejects(roleQuery(role, reviewCall), /permission denied for function apply_price_review/);
  await assert.rejects(roleQuery(role, "select * from manga"), /permission denied/);
  for (const view of ["price_review_queue", "edition_readiness"]) {
    await assert.rejects(roleQuery(role, `select * from ${view}`), /permission denied/);
  }
  const shelf = (await roleQuery(role, "select * from public_shelf_editions")).rows;
  assert.deepEqual(shelf, [{ username: "PublicCollector", username_key: "publiccollector", edition_id: "00000000-0000-0000-0000-000000000001" }]);
  assert.equal((await roleQuery(role, "select * from portfolio_holdings")).rows.length, 0);
  assert.equal((await roleQuery(role, "select * from edition_sources")).rows.length, 0);
  const catalogue = (await roleQuery(role, "select * from alpha_catalogue_v1")).rows;
  assert.equal(catalogue.length, 1);
  assert.equal(catalogue[0].title, "Verified fixture");
  assert.equal(catalogue[0].verified_sale_count, 0);
  const readiness = (await roleQuery(role, "select * from publication_print_readiness order by publication_id")).rows;
  assert.equal(readiness[0].total_verified_sale_count, 0, "review-needed sale is not price evidence");
  const availability = (await roleQuery(role, "select * from publication_availability")).rows[0];
  assert.equal(Number(availability.live_now), 1);
  assert.equal(Number(availability.completed_scans), 1);
  for (const view of ["alpha_catalogue_v1", "publication_print_readiness", "publication_availability", "public_shelf_editions"]) {
    for (const permission of ["INSERT", "UPDATE", "DELETE"]) {
      const allowed = (await db.query("select has_table_privilege($1,$2,$3) as allowed", [role, view, permission])).rows[0].allowed;
      assert.equal(allowed, false, `${role} must not ${permission} ${view}`);
    }
  }
  assert.equal((await roleQuery(role, "select unrelated_public_rpc() as result")).rows[0].result, 7);
}
assert.equal((await db.query("select is_verified from price_observations")).rows[0].is_verified, false);
assert.equal((await db.query("select * from price_review_decisions")).rows.length, 0);
await roleQuery("service_role", reviewCall);
assert.equal((await db.query("select is_verified from price_observations")).rows[0].is_verified, true);
assert.equal((await db.query("select * from price_review_decisions")).rows.length, 1);
assert.equal((await roleQuery("service_role", "select * from manga")).rows.length, 1);
assert.equal((await roleQuery("service_role", "select * from edition_readiness")).rows.length, 2);
await roleQuery("service_role", "select * from price_review_queue");
// Existing collector trigger still enforces reserved names after EXECUTE revoke.
await assert.rejects(roleQuery("authenticated", `insert into collector_profiles (user_id,username,username_key)
  values ('00000000-0000-0000-0000-000000000023','admin','admin')`), /reserved/);
await roleQuery("authenticated", `insert into collector_profiles (user_id,username,username_key)
  values ('00000000-0000-0000-0000-000000000023','AnotherCollector','anothercollector')`);
await assert.rejects(roleQuery("authenticated", `insert into collector_profiles (user_id,username,username_key)
  values (gen_random_uuid(),'WrongOwner','wrongowner')`), /row-level security/);
await db.exec("update collector_profiles set shelf_is_public=false where username_key='publiccollector'");
assert.equal((await roleQuery("anon", "select * from public_shelf_editions")).rows.length, 0, "opt-out immediately hides shelf");
await db.exec("create function future_staff_rpc() returns integer language sql as $$ select 1 $$;");
for (const role of ["anon", "authenticated"]) {
  await assert.rejects(roleQuery(role, "select future_staff_rpc()"), /permission denied/);
}
assert.equal((await roleQuery("service_role", "select future_staff_rpc() as result")).rows[0].result, 1);
await db.close();
console.log("Database permissions: staff RPC denial, service access, future defaults, legacy RLS, public projections, shelf privacy and trigger enforcement passed (isolated single session).");
