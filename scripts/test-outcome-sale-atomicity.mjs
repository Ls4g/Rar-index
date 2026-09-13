// Atomic outcome-to-sale completion, against a real PostgreSQL engine.
//
//   node --experimental-strip-types scripts/test-outcome-sale-atomicity.mjs
//
// The existing test-outcome-sale-confirmation.mjs exercises the TypeScript
// helper against a mock database. A mock cannot demonstrate atomicity: it will
// happily report whatever the code asked it to, including a rollback that the
// real engine would never have performed. So this file runs the SHIPPED
// migration SQL -- read from supabase/migrations, never retyped -- inside
// PGlite, which is genuine PostgreSQL compiled to WebAssembly.
//
// What this establishes: that an exception anywhere inside the unit leaves no
// observation, no review decision, no print classification, no intake audit
// and no closed outcome behind; that a retry returns the first answer instead
// of creating a second sale; and that a human decision recorded first is
// refused rather than overwritten.
//
// What this does NOT establish: behaviour under two genuinely simultaneous
// connections. PGlite runs a single backend, so `for update` cannot be
// observed blocking a second session here. The lock's effect is argued from
// PostgreSQL semantics and backed up by the conditional-column guards, which
// ARE tested. A two-connection test needs a real server (Docker/Supabase
// local), which is not available on this machine.
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

// Roles the shipped migrations grant to. They exist in Supabase; create them
// here so the real files run unedited.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  -- Stub for the append-only trigger the intake migration attaches. The real
  -- one lives in an earlier migration and is not what is under test.
  create or replace function public.block_agent_reliability_mutation() returns trigger
  language plpgsql as $$ begin raise exception 'append only'; end; $$;

  create table public.manga_editions (id uuid primary key default gen_random_uuid(), is_verified boolean not null default true);
  create table public.sources (id uuid primary key default gen_random_uuid(), is_active boolean not null default true);

  create table public.price_observations (
    id uuid primary key default gen_random_uuid(),
    edition_id uuid not null references public.manga_editions(id),
    collection_run_id uuid,
    source_id uuid not null references public.sources(id),
    source_listing_url text not null,
    external_id text,
    listing_title text not null,
    sold_date date,
    sale_price numeric,
    currency text,
    shipping_price numeric,
    quantity integer,
    sale_type text,
    grading_company text,
    grade_label text,
    raw_payload jsonb not null default '{}'::jsonb,
    is_verified boolean not null default false,
    notes text,
    match_status text,
    reviewed_at timestamptz,
    reviewed_by text,
    sale_status text,
    print_classification text,
    printing_proof_url text,
    known_printing_number integer,
    created_at timestamptz not null default now()
  );
  create unique index price_observations_source_external_id_unique
    on public.price_observations(source_id, external_id);

  create table public.price_review_decisions (
    id uuid primary key default gen_random_uuid(),
    observation_id uuid not null references public.price_observations(id),
    decision text not null, decision_notes text, reviewed_by text not null,
    created_at timestamptz not null default now()
  );
  create table public.price_print_classification_decisions (
    id uuid primary key default gen_random_uuid(),
    observation_id uuid not null references public.price_observations(id),
    classification text not null, printing_proof_url text, known_printing_number integer,
    decision_notes text, reviewed_by text not null,
    created_at timestamptz not null default now()
  );
  create table public.agent_human_feedback (
    id uuid primary key default gen_random_uuid(),
    workflow text not null, subject_key text not null, outcome text not null,
    reason_label text, note text, reviewed_by text not null,
    created_at timestamptz not null default now()
  );

  create table public.listing_outcomes (
    id uuid primary key default gen_random_uuid(),
    source_id uuid not null references public.sources(id),
    external_id text not null,
    marketplace text not null default 'EBAY_GB',
    source_listing_url text not null,
    profile_id uuid,
    edition_id uuid not null references public.manga_editions(id),
    listing_title text not null,
    image_url text, asking_price numeric, currency text, buying_format text,
    bid_count integer, scheduled_end_at timestamptz,
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    original_snapshot jsonb not null default '{}'::jsonb,
    match_assessment jsonb not null default '{}'::jsonb,
    status text not null default 'active'
      check (status in ('active','ended_pending_check','sold_candidate','unsold','ambiguous','inaccessible','review_complete')),
    sold_price numeric, sold_currency text, sold_at timestamptz,
    outcome_reason text, outcome_provider text,
    check_attempts integer not null default 0,
    next_check_at timestamptz, last_checked_at timestamptz, last_error text,
    resulting_observation_id uuid references public.price_observations(id),
    reviewed_by text, reviewed_at timestamptz, review_notes text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
`);

// The shipped SQL, run exactly as it will run in production.
for (const file of ["20260904_approved_sale_intake.sql", "20260913_atomic_outcome_sale_closure.sql"]) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
}
console.log("loaded shipped migrations: approved_sale_intake, atomic_outcome_sale_closure");

const { rows: [{ id: editionId }] } = await db.query("insert into public.manga_editions default values returning id");
const { rows: [{ id: otherEditionId }] } = await db.query("insert into public.manga_editions default values returning id");
const { rows: [{ id: sourceId }] } = await db.query("insert into public.sources default values returning id");

let counter = 0;
async function makeOutcome(overrides = {}) {
  counter += 1;
  const legacy = String(200000000000 + counter);
  const row = {
    external_id: legacy,
    source_listing_url: `https://www.ebay.co.uk/itm/${legacy}`,
    listing_title: "Berserk Deluxe Edition Volume 1 Dark Horse",
    status: "sold_candidate",
    sold_price: 48.5, sold_currency: "GBP", sold_at: "2026-09-01T12:00:00Z",
    buying_format: "FIXED_PRICE", edition_id: editionId,
    ...overrides,
  };
  const { rows: [{ id }] } = await db.query(
    `insert into public.listing_outcomes
       (source_id, external_id, source_listing_url, edition_id, listing_title, status,
        sold_price, sold_currency, sold_at, buying_format, reviewed_by, resulting_observation_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
    [sourceId, row.external_id, row.source_listing_url, row.edition_id, row.listing_title, row.status,
      row.sold_price, row.sold_currency, row.sold_at, row.buying_format,
      row.reviewed_by ?? null, row.resulting_observation_id ?? null],
  );
  return { id, legacy };
}

async function confirm(outcomeId, legacy, overrides = {}) {
  const args = {
    saleType: "fixed_price", company: null, grade: null, corroboration: null,
    payload: {}, detector: {}, notes: null, reviewer: "AUDIT", ...overrides,
  };
  const { rows } = await db.query(
    "select public.confirm_outcome_sale($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as result",
    [outcomeId, legacy, args.saleType, args.company, args.grade, args.corroboration,
      JSON.stringify(args.payload), JSON.stringify(args.detector), args.notes, args.reviewer],
  );
  return rows[0].result;
}

async function counts() {
  const { rows: [row] } = await db.query(`select
    (select count(*)::int from public.price_observations) as observations,
    (select count(*)::int from public.price_review_decisions) as reviews,
    (select count(*)::int from public.price_print_classification_decisions) as printings,
    (select count(*)::int from public.sale_intake_decisions) as intakes,
    (select count(*)::int from public.agent_human_feedback) as feedback,
    (select count(*)::int from public.listing_outcomes where status = 'review_complete') as closed`);
  return row;
}

async function outcomeRow(id) {
  const { rows: [row] } = await db.query(
    "select status, reviewed_by, resulting_observation_id, review_notes from public.listing_outcomes where id = $1", [id]);
  return row;
}

console.log("\n--- the whole unit commits together ---");
{
  const before = await counts();
  const { id, legacy } = await makeOutcome();
  const result = await confirm(id, legacy, { notes: "Checked the sold page." });
  const after = await counts();
  check("a sale is created", after.observations - before.observations, 1);
  check("its verified-match review is written", after.reviews - before.reviews, 1);
  check("its print classification is written", after.printings - before.printings, 1);
  check("its intake audit is written", after.intakes - before.intakes, 1);
  check("agent feedback is written", after.feedback - before.feedback, 1);
  check("the outcome is closed in the same call", after.closed - before.closed, 1);
  check("the result reports the closure", [result.ok, result.status, result.reused], [true, "review_complete", false]);
  const row = await outcomeRow(id);
  check("the outcome carries its observation", row.resulting_observation_id, result.observationId);
  check("the reviewer is recorded", row.reviewed_by, "AUDIT");
  const { rows: [obs] } = await db.query(
    "select is_verified, match_status, sale_status, print_classification, sale_price, currency from public.price_observations where id = $1",
    [result.observationId]);
  check("the sale is verified evidence", [obs.is_verified, obs.match_status, obs.sale_status], [true, "verified_match", "confirmed"]);
  check("printing is left unidentified, not guessed", obs.print_classification, "printing_not_identified");
  check("the stored price is the outcome's own", [Number(obs.sale_price), obs.currency], [48.5, "GBP"]);
}

console.log("\n--- a failure anywhere leaves nothing behind ---");
{
  // A Best Offer with no corroborating link. approve_submitted_sale refuses it
  // partway through the unit, AFTER the observation insert would have run.
  const before = await counts();
  const { id, legacy } = await makeOutcome({ buying_format: "FIXED_PRICE,BEST_OFFER" });
  let error = null;
  try { await confirm(id, legacy, { saleType: "best_offer", corroboration: null }); } catch (caught) { error = caught; }
  checkRaises("Best Offer without an accepted price is refused", error, "corroboration");
  check("no partial evidence survives", await counts(), before);
  check("the outcome is untouched", await outcomeRow(id), { status: "sold_candidate", reviewed_by: null, resulting_observation_id: null, review_notes: null });
}
{
  // An unverified edition. The refusal comes from deep inside the intake
  // function, after this one has already done its own checks.
  const before = await counts();
  await db.query("update public.manga_editions set is_verified = false where id = $1", [otherEditionId]);
  const { id, legacy } = await makeOutcome({ edition_id: otherEditionId });
  let error = null;
  try { await confirm(id, legacy); } catch (caught) { error = caught; }
  checkRaises("an unverified edition is refused", error, "verified RAR edition");
  check("nothing was written", await counts(), before);
  await db.query("update public.manga_editions set is_verified = true where id = $1", [otherEditionId]);
}

console.log("\n--- a crashed request leaves the queue open, not half-done ---");
{
  const before = await counts();
  const { id, legacy } = await makeOutcome();
  await db.exec("begin");
  const result = await confirm(id, legacy);
  check("the call succeeded inside the transaction", result.ok, true);
  await db.exec("rollback");
  check("after the rollback no evidence exists", await counts(), before);
  check("and the outcome is still awaiting a human", (await outcomeRow(id)).status, "sold_candidate");
}

console.log("\n--- retries are idempotent ---");
{
  const { id, legacy } = await makeOutcome();
  const first = await confirm(id, legacy);
  const before = await counts();
  const second = await confirm(id, legacy);
  const third = await confirm(id, legacy, { reviewer: "SOMEONE-ELSE" });
  check("the retry returns the same sale", second.observationId, first.observationId);
  check("and says so rather than pretending it created one", [second.reused, second.alreadyClosed], [true, true]);
  check("a different reviewer retrying also gets the same sale", third.observationId, first.observationId);
  check("no second sale, review, printing or audit is created", await counts(), before);
}

console.log("\n--- a human decision already recorded is never overwritten ---");
{
  const before = await counts();
  const { id, legacy } = await makeOutcome();
  await db.query("update public.listing_outcomes set status = 'unsold', reviewed_by = 'COLLEAGUE' where id = $1", [id]);
  let error = null;
  try { await confirm(id, legacy); } catch (caught) { error = caught; }
  checkRaises("the conflict names who decided", error, "Already reviewed by COLLEAGUE");
  check("nothing was written", await counts(), before);
  check("their decision stands", (await outcomeRow(id)).status, "unsold");
}

console.log("\n--- ended, ambiguous and inaccessible are not sold ---");
for (const status of ["ended_pending_check", "ambiguous", "inaccessible", "unsold", "active"]) {
  const before = await counts();
  const { id, legacy } = await makeOutcome({ status });
  let error = null;
  try { await confirm(id, legacy); } catch (caught) { error = caught; }
  checkRaises(`"${status}" cannot be confirmed as a sale`, error, "Only a sold candidate");
  check(`"${status}" wrote nothing`, await counts(), before);
}

console.log("\n--- missing evidence is refused, never filled in ---");
for (const [label, overrides, fragment] of [
  ["no price", { sold_price: null }, "no completed-sale price"],
  ["a zero price", { sold_price: 0 }, "no completed-sale price"],
  ["no currency", { sold_currency: null }, "no valid currency"],
  ["no date", { sold_at: null }, "no usable completed-sale date"],
  ["a future date", { sold_at: "2027-01-01T00:00:00Z" }, "no usable completed-sale date"],
]) {
  const before = await counts();
  const { id, legacy } = await makeOutcome(overrides);
  let error = null;
  try { await confirm(id, legacy); } catch (caught) { error = caught; }
  checkRaises(`${label} is refused`, error, fragment);
  check(`${label} wrote nothing`, await counts(), before);
}

console.log("\n--- eBay's two spellings of a listing id ---");
{
  // The Browse API's RESTful id, stored on the outcome. The numeric id is what
  // the listing URL carries and what the sale must be keyed on.
  counter += 1;
  const legacy = String(300000000000 + counter);
  const { rows: [{ id }] } = await db.query(
    `insert into public.listing_outcomes
       (source_id, external_id, source_listing_url, edition_id, listing_title, status, sold_price, sold_currency, sold_at, buying_format)
     values ($1,$2,$3,$4,'Vagabond VIZBIG Edition Volume 1','sold_candidate',60,'USD','2026-08-20T00:00:00Z','AUCTION') returning id`,
    [sourceId, `v1|${legacy}|0`, `https://www.ebay.com/itm/${legacy}`, editionId]);
  const result = await confirm(id, legacy, { saleType: "auction" });
  const { rows: [obs] } = await db.query("select external_id from public.price_observations where id = $1", [result.observationId]);
  check("a RESTful outcome id is stored as the numeric listing id", obs.external_id, legacy);
}
{
  // The reverse: an observation already saved in RESTful form must be found,
  // not duplicated, when the same listing is confirmed by its numeric id.
  counter += 1;
  const legacy = String(400000000000 + counter);
  await db.query(
    `insert into public.price_observations
       (edition_id, source_id, source_listing_url, external_id, listing_title, sold_date, sale_price, currency,
        quantity, sale_type, is_verified, match_status, sale_status, reviewed_by, reviewed_at, print_classification)
     values ($1,$2,$3,$4,'One Piece Volume 1 Viz','2026-08-01',30,'GBP',1,'fixed_price',true,'verified_match','confirmed','EARLIER',now(),'printing_not_identified')`,
    [editionId, sourceId, `https://www.ebay.co.uk/itm/${legacy}`, `v1|${legacy}|0`]);
  const { rows: [{ id }] } = await db.query(
    `insert into public.listing_outcomes
       (source_id, external_id, source_listing_url, edition_id, listing_title, status, sold_price, sold_currency, sold_at, buying_format)
     values ($1,$2,$3,$4,'One Piece Volume 1 Viz','sold_candidate',30,'GBP','2026-08-01T00:00:00Z','FIXED_PRICE') returning id`,
    [sourceId, legacy, `https://www.ebay.co.uk/itm/${legacy}`, editionId]);
  const before = await counts();
  const result = await confirm(id, legacy);
  const after = await counts();
  check("the existing RESTful observation is reused", result.reused, true);
  check("no duplicate sale is created", after.observations - before.observations, 0);
  check("the outcome still closes", after.closed - before.closed, 1);
  const { rows: [obs] } = await db.query("select reviewed_by from public.price_observations where id = $1", [result.observationId]);
  check("the earlier reviewer is not overwritten", obs.reviewed_by, "EARLIER");
}
{
  const { id } = await makeOutcome();
  let error = null;
  try { await confirm(id, "999999999999"); } catch (caught) { error = caught; }
  checkRaises("a link that disagrees with the stored id is refused", error, "do not agree");
}

console.log("\n--- an existing observation is never reassigned or re-verified ---");
{
  counter += 1;
  const legacy = String(500000000000 + counter);
  await db.query(
    `insert into public.price_observations
       (edition_id, source_id, source_listing_url, external_id, listing_title, sold_date, sale_price, currency,
        quantity, sale_type, is_verified, match_status, sale_status, print_classification)
     values ($1,$2,$3,$4,'Naruto Volume 1','2026-08-01',20,'GBP',1,'fixed_price',true,'verified_match','confirmed','printing_not_identified')`,
    [otherEditionId, sourceId, `https://www.ebay.co.uk/itm/${legacy}`, legacy]);
  const { rows: [{ id }] } = await db.query(
    `insert into public.listing_outcomes
       (source_id, external_id, source_listing_url, edition_id, listing_title, status, sold_price, sold_currency, sold_at, buying_format)
     values ($1,$2,$3,$4,'Naruto Volume 1','sold_candidate',20,'GBP','2026-08-01T00:00:00Z','FIXED_PRICE') returning id`,
    [sourceId, legacy, `https://www.ebay.co.uk/itm/${legacy}`, editionId]);
  let error = null;
  try { await confirm(id, legacy); } catch (caught) { error = caught; }
  checkRaises("a sale belonging to another edition is refused", error, "another edition");
  const { rows: [obs] } = await db.query("select edition_id from public.price_observations where external_id = $1", [legacy]);
  check("and that sale keeps its edition", obs.edition_id, otherEditionId);
}
{
  counter += 1;
  const legacy = String(600000000000 + counter);
  await db.query(
    `insert into public.price_observations
       (edition_id, source_id, source_listing_url, external_id, listing_title, sold_date, sale_price, currency,
        quantity, sale_type, is_verified, match_status, sale_status, print_classification)
     values ($1,$2,$3,$4,'Bleach Volume 1','2026-08-01',20,'GBP',1,'fixed_price',false,'needs_review','confirmed','printing_not_identified')`,
    [editionId, sourceId, `https://www.ebay.co.uk/itm/${legacy}`, legacy]);
  const { rows: [{ id }] } = await db.query(
    `insert into public.listing_outcomes
       (source_id, external_id, source_listing_url, edition_id, listing_title, status, sold_price, sold_currency, sold_at, buying_format)
     values ($1,$2,$3,$4,'Bleach Volume 1','sold_candidate',20,'GBP','2026-08-01T00:00:00Z','FIXED_PRICE') returning id`,
    [sourceId, legacy, `https://www.ebay.co.uk/itm/${legacy}`, editionId]);
  let error = null;
  try { await confirm(id, legacy); } catch (caught) { error = caught; }
  checkRaises("an unverified existing observation is refused", error, "unverified or excluded");
  const { rows: [obs] } = await db.query("select is_verified, match_status from public.price_observations where external_id = $1", [legacy]);
  check("and it is not verified behind the human's back", [obs.is_verified, obs.match_status], [false, "needs_review"]);
}

console.log("\n--- grading and Best Offer evidence are preserved ---");
{
  const { id, legacy } = await makeOutcome({ listing_title: "Hunter x Hunter 1 BGS 8.5" });
  const result = await confirm(id, legacy, { company: "BGS", grade: "8.5" });
  const { rows: [obs] } = await db.query(
    "select grading_company, grade_label from public.price_observations where id = $1", [result.observationId]);
  check("the grade a human confirmed is stored", [obs.grading_company, obs.grade_label], ["BGS", "8.5"]);
}
{
  const { id, legacy } = await makeOutcome({ buying_format: "FIXED_PRICE,BEST_OFFER" });
  const result = await confirm(id, legacy, { saleType: "best_offer", corroboration: "https://130point.com/sales/" });
  const { rows: [obs] } = await db.query(
    "select sale_type, raw_payload->>'price_corroboration_url' as corroboration from public.price_observations where id = $1",
    [result.observationId]);
  check("an accepted Best Offer keeps its type and its corroboration", [obs.sale_type, obs.corroboration], ["best_offer", "https://130point.com/sales/"]);
}
{
  const { id, legacy } = await makeOutcome();
  let error = null;
  try { await confirm(id, legacy, { reviewer: "   " }); } catch (caught) { error = caught; }
  checkRaises("an anonymous confirmation is refused", error, "name or initials");
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
await db.close();
process.exit(failures === 0 ? 0 : 1);
