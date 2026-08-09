-- Publication -> print-run sales model. Purely additive: new columns with
-- safe defaults, new constraints, new functions, new views. Nothing existing
-- is renamed, dropped, or rewritten in place. See AGENTS.md's evidence rules
-- and docs/catalogue-intake-runbook.md's "a sale is never evidence for a
-- printing unless its listing or supplied inspection evidence proves that
-- printing" — this migration turns that rule into real, enforced columns
-- instead of an edition-level printing_number stand-in.

-- 1. Explicit, unambiguous publication vs print-run identity ----------------
-- printing_of_edition_id already links a specific print record to its
-- general/root record in a few cases; record_kind makes that explicit and
-- impossible to drift (it's derived, not app-maintained).
alter table public.manga_editions
  add column if not exists record_kind text generated always as (
    case when printing_of_edition_id is not null then 'print_run' else 'publication' end
  ) stored;

create index if not exists manga_editions_record_kind_idx on public.manga_editions(record_kind);

-- Keeps the model exactly two levels deep (publication -> print run), which
-- the whole page/query model below assumes. A print-run record's parent must
-- itself be a publication, never another print-run record. A plain check
-- constraint can't do this (cross-row lookup), hence the trigger.
create or replace function public.enforce_print_run_depth()
returns trigger
language plpgsql
as $$
begin
  if new.printing_of_edition_id is not null then
    if exists (
      select 1 from public.manga_editions parent
      where parent.id = new.printing_of_edition_id
        and parent.printing_of_edition_id is not null
    ) then
      raise exception 'A print-run record must link directly to a publication, not to another print-run record';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists manga_editions_print_run_depth on public.manga_editions;
create trigger manga_editions_print_run_depth
  before insert or update of printing_of_edition_id on public.manga_editions
  for each row execute function public.enforce_print_run_depth();

-- 2. Per-sale print classification -------------------------------------------
-- A sale's printing status is a property of that specific sold copy, not of
-- the catalogue edition it's attached to. Every existing and future sale
-- gets one of exactly three classifications, defaulting to the honest
-- unproven state.
alter table public.price_observations
  add column if not exists print_classification text not null default 'printing_not_identified'
    check (print_classification in ('first_print_proven', 'known_later_print', 'printing_not_identified')),
  add column if not exists printing_proof_url text,
  add column if not exists known_printing_number integer check (known_printing_number is null or known_printing_number >= 1);

-- A title claim or an edition's own reputation can never satisfy this on its
-- own: first_print_proven requires a direct proof URL tied to that sale.
alter table public.price_observations
  add constraint price_observations_first_print_needs_proof
  check (print_classification <> 'first_print_proven' or printing_proof_url is not null);

create index if not exists price_observations_print_classification_idx
  on public.price_observations(print_classification);

-- 3. Auditable classification decisions --------------------------------------
-- Mirrors apply_price_review / price_review_decisions exactly: a named
-- reviewer, a real note, and a permanent audit row. This is the only path
-- that can move print_classification away from its safe default -- no
-- workflow may set it directly via a plain insert/update.
create table if not exists public.price_print_classification_decisions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.price_observations(id) on delete cascade,
  classification text not null check (classification in ('first_print_proven', 'known_later_print', 'printing_not_identified')),
  printing_proof_url text,
  known_printing_number integer,
  decision_notes text not null check (length(trim(decision_notes)) >= 12),
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

alter table public.price_print_classification_decisions enable row level security;
create index if not exists price_print_classification_decisions_observation_created_idx
  on public.price_print_classification_decisions(observation_id, created_at desc);

create or replace function public.apply_price_print_classification(
  p_observation_id uuid,
  p_classification text,
  p_printing_proof_url text,
  p_known_printing_number integer,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proof_url text := nullif(trim(coalesce(p_printing_proof_url, '')), '');
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
begin
  if p_classification not in ('first_print_proven', 'known_later_print', 'printing_not_identified') then
    raise exception 'Invalid print classification';
  end if;
  if v_reviewer is null then
    raise exception 'Reviewer is required';
  end if;
  if v_notes is null or length(v_notes) < 12 then
    raise exception 'A classification note of at least 12 characters is required';
  end if;
  if p_classification = 'first_print_proven' and v_proof_url is null then
    raise exception 'A first-print classification requires a direct printing-proof URL';
  end if;
  if p_known_printing_number is not null and p_known_printing_number < 1 then
    raise exception 'Known printing number must be a positive number';
  end if;
  if not exists (select 1 from public.price_observations where id = p_observation_id) then
    raise exception 'Price observation % does not exist', p_observation_id;
  end if;

  update public.price_observations
  set print_classification = p_classification,
      printing_proof_url = v_proof_url,
      known_printing_number = p_known_printing_number,
      updated_at = now()
  where id = p_observation_id;

  insert into public.price_print_classification_decisions (
    observation_id, classification, printing_proof_url, known_printing_number, decision_notes, reviewed_by
  ) values (
    p_observation_id, p_classification, v_proof_url, p_known_printing_number, v_notes, trim(p_reviewed_by)
  );
end;
$$;

revoke all on function public.apply_price_print_classification(uuid, text, text, integer, text, text) from public;

-- 4. Conservative backfill, audited by row ID --------------------------------
-- Audited 2026-08-09 against each sale's OWN review notes, not the edition's
-- name or claim: of the 46 existing price_observations rows, only these 6
-- have a human reviewer's note that specifically ties copyright-page or
-- printing-line proof to that exact sale. Every other row -- including
-- several Japanese Jujutsu Kaisen and Black Clover sales whose LISTING TITLE
-- reads "1st Print" -- has no such note (several carry only the generic
-- "Added through Quick sale intake. Awaiting staff review of the original
-- listing and exact-edition evidence." boilerplate, never followed up) and
-- is correctly left at the column default, printing_not_identified.
--
-- One Piece Japanese Vol. 1 sale b54d1543 is deliberately excluded despite
-- escalating review notes on file: its own history explicitly records "no
-- publication-page or printing-line image is stored... Keep under review,"
-- so it stays printing_not_identified rather than being inferred from the
-- edition's "1997 first printing (verified)" name.
--
-- Applied via the real apply_price_print_classification function (not a raw
-- update) so each backfilled row gets the same validation and the same
-- permanent audit trail any future staff classification would get.

-- One Piece Vol. 1 Japanese (edition f85e616c-7aa8-4806-8c18-2af0d5aa78be):
select public.apply_price_print_classification(
  'd6cc0dd1-02ac-405c-9a19-95c8fe44d53c'::uuid,
  'first_print_proven',
  'https://i.ebayimg.com/images/g/0XwAAeSw-BlqHGF7/s-l1600.webp',
  1,
  'Migration backfill: existing review note states the listing copyright-page image shows 1997-12-29 first printing and ISBN 9784088725093 (eBay 377240264904).',
  'RAR migration audit'
);

select public.apply_price_print_classification(
  '3046be94-d1b5-45d1-91a4-e819d2b2c676'::uuid,
  'first_print_proven',
  'https://i.ebayimg.com/images/g/cQoAAeSw77xqEMl~/s-l1600.webp',
  1,
  'Migration backfill: existing review note states the listing copyright-page photo shows 1997-12-29 first printing and ISBN 9784088725093 (eBay 800055394441).',
  'RAR migration audit'
);

select public.apply_price_print_classification(
  'c2f18f63-005e-45c4-94a8-4c7432bd833a'::uuid,
  'first_print_proven',
  'https://i.ebayimg.com/images/g/iDwAAeSwPeFqDSGy/s-l1600.webp',
  1,
  'Migration backfill: existing review note states the listing copyright-page image shows 1997-12-29 first printing and ISBN 9784088725093 (eBay 366419349362).',
  'RAR migration audit'
);

-- Hunter x Hunter Vol. 1 Japanese (edition 52e1799d-cb86-4e3e-b67c-3b5c2092404d):
select public.apply_price_print_classification(
  'd3213375-ce99-463b-8186-bb09a79682e3'::uuid,
  'first_print_proven',
  'https://i.ebayimg.com/images/g/LbIAAeSwKzZqWPXF/s-l140.webp',
  1,
  'Migration backfill: existing review note states copyright-page inspection confirms the 9 June 1998 Japanese first printing (eBay 358803976246).',
  'RAR migration audit'
);

select public.apply_price_print_classification(
  '1fd3dd8b-b769-43d5-a5cb-3c1fdca3c160'::uuid,
  'first_print_proven',
  'https://i.ebayimg.com/images/g/aWcAAeSwn0ZqQmoI/s-l1600.webp',
  1,
  'Migration backfill: existing review note states copyright-page inspection confirms ISBN 9784088725710 and dai-1-satsu for the Japanese first printing (eBay 236740431432).',
  'RAR migration audit'
);

select public.apply_price_print_classification(
  'db193ab9-7557-4aea-a12e-00957a07e68d'::uuid,
  'first_print_proven',
  'https://i.ebayimg.com/images/g/7EsAAeSwgE5p6ofX/s-l1600.webp',
  1,
  'Migration backfill: existing review note states copyright-page inspection confirms ISBN 9784088725710 and dai-1-satsu for the Japanese first printing (eBay 397873474336).',
  'RAR migration audit'
);

-- 5. Staff triage: sales awaiting print classification -----------------------
-- Confirmed, edition-matched sales still sitting at the honest default,
-- flagged when the listing title reads as a first-print claim or the import
-- already captured an image nobody has reviewed for printing proof yet --
-- exactly the Jujutsu Kaisen / Black Clover gap found during this migration's
-- audit above.
create or replace view public.print_classification_queue
with (security_invoker = true)
as
select
  po.id as observation_id,
  po.edition_id,
  edition.title,
  edition.series,
  edition.volume_number,
  edition.language,
  edition.publisher,
  po.listing_title,
  po.source_listing_url,
  po.sold_date,
  po.sale_price,
  po.currency,
  po.print_classification,
  (
    po.listing_title ~* '(1st|first)\s*print|first\s*edition|第\d+刷'
    or po.raw_payload::text ~* 'evidence_image_url"\s*:\s*"http'
  ) as has_unreviewed_evidence_hint
from public.price_observations po
join public.manga_editions edition on edition.id = po.edition_id
where po.match_status = 'verified_match'
  and po.sale_status = 'confirmed'
  and po.print_classification = 'printing_not_identified'
order by has_unreviewed_evidence_hint desc, po.sold_date desc nulls last;

-- 6. Publication-level rollup --------------------------------------------------
-- One row per publication (record_kind = 'publication'), aggregating sales
-- across itself and every print-run child. Feeds public discovery-surface
-- counters/badges and the staff migration readiness report. Only counts
-- confirmed, edition-verified sales -- Scout leads and needs_review/excluded
-- rows never contribute.
-- security_invoker = false (matching alpha_catalogue_v1, the one proven
-- working pattern in this codebase for a view granted to anon): the base
-- tables' RLS would otherwise block anonymous reads through this view.
create or replace view public.publication_print_readiness
with (security_invoker = false)
as
with family as (
  select publication.id as publication_id, publication.id as member_edition_id
  from public.manga_editions publication
  where publication.record_kind = 'publication'
  union all
  select child.printing_of_edition_id as publication_id, child.id as member_edition_id
  from public.manga_editions child
  where child.record_kind = 'print_run'
),
sales as (
  select
    family.publication_id,
    count(*) filter (
      where po.match_status = 'verified_match' and po.sale_status = 'confirmed'
        and po.print_classification = 'first_print_proven'
    )::integer as first_print_proven_sale_count,
    count(*) filter (
      where po.match_status = 'verified_match' and po.sale_status = 'confirmed'
        and po.print_classification = 'known_later_print'
    )::integer as known_later_print_sale_count,
    count(*) filter (
      where po.match_status = 'verified_match' and po.sale_status = 'confirmed'
        and po.print_classification = 'printing_not_identified'
    )::integer as printing_not_identified_sale_count,
    count(*) filter (
      where po.match_status = 'verified_match' and po.sale_status = 'confirmed'
    )::integer as total_verified_sale_count
  from family
  left join public.price_observations po on po.edition_id = family.member_edition_id
  group by family.publication_id
)
select
  publication.id as publication_id,
  publication.title,
  publication.series,
  publication.volume_number,
  publication.language,
  publication.publisher,
  publication.isbn_13,
  publication.is_verified,
  coalesce(sales.first_print_proven_sale_count, 0) as first_print_proven_sale_count,
  coalesce(sales.known_later_print_sale_count, 0) as known_later_print_sale_count,
  coalesce(sales.printing_not_identified_sale_count, 0) as printing_not_identified_sale_count,
  coalesce(sales.total_verified_sale_count, 0) as total_verified_sale_count,
  coalesce(sales.first_print_proven_sale_count, 0) > 0 as has_first_print_evidence
from public.manga_editions publication
left join sales on sales.publication_id = publication.id
where publication.record_kind = 'publication';

grant select on public.publication_print_readiness to anon, authenticated;

-- 7. Extend edition_readiness (append-only, same pattern as the 2026-08-04
-- coverage-columns migration) with per-edition print-classification counts.
create or replace view public.edition_readiness as
with evidence as (
  select edition_id, count(*)::integer as evidence_count
  from public.edition_sources
  group by edition_id
),
profiles as (
  select edition_id, count(*) filter (where is_active)::integer as active_profile_count
  from public.marketplace_search_profiles
  group by edition_id
),
runs as (
  select profile.edition_id, count(run.id)::integer as collection_run_count
  from public.marketplace_search_profiles profile
  left join public.marketplace_collection_runs run on run.profile_id = profile.id
  group by profile.edition_id
),
sales as (
  select
    edition_id,
    count(*) filter (where match_status = 'verified_match' and sale_status = 'confirmed')::integer as verified_sale_count,
    count(*) filter (where match_status = 'needs_review')::integer as review_sale_count,
    count(*) filter (where match_status = 'verified_match' and sale_status = 'confirmed' and print_classification = 'first_print_proven')::integer as first_print_proven_sale_count,
    count(*) filter (where match_status = 'verified_match' and sale_status = 'confirmed' and print_classification = 'printing_not_identified')::integer as printing_not_identified_sale_count
  from public.price_observations
  group by edition_id
),
pending_leads as (
  select profile.edition_id, count(lead.id) filter (where lead.review_status = 'new')::integer as pending_lead_count
  from public.marketplace_search_profiles profile
  join public.scout_listing_leads lead on lead.profile_id = profile.id
  group by profile.edition_id
)
select
  edition.id as edition_id,
  edition.title,
  edition.series,
  edition.volume_number,
  edition.language,
  edition.isbn_13,
  edition.publisher,
  edition.release_date,
  edition.printing_number,
  edition.is_verified,
  coalesce(evidence.evidence_count, 0) as evidence_count,
  coalesce(profiles.active_profile_count, 0) as active_profile_count,
  coalesce(runs.collection_run_count, 0) as collection_run_count,
  coalesce(sales.verified_sale_count, 0) as verified_sale_count,
  coalesce(sales.review_sale_count, 0) as review_sale_count,
  case
    when not edition.is_verified then 'needs_catalogue_review'
    when edition.isbn_13 is null or edition.publisher is null or edition.release_date is null then 'catalogue_incomplete'
    when coalesce(evidence.evidence_count, 0) = 0 then 'evidence_needed'
    when coalesce(profiles.active_profile_count, 0) = 0 then 'profile_needed'
    when coalesce(runs.collection_run_count, 0) = 0 then 'search_ready'
    when coalesce(sales.review_sale_count, 0) > 0 then 'under_review'
    when coalesce(sales.verified_sale_count, 0) > 0 then 'valuation_ready'
    else 'collecting'
  end as readiness_status,
  edition.edition_statement,
  edition.variant_name,
  edition.collectible_type,
  edition.cover_verification_status,
  edition.printing_of_edition_id,
  coalesce(pending_leads.pending_lead_count, 0) as pending_lead_count,
  edition.record_kind,
  coalesce(sales.first_print_proven_sale_count, 0) as first_print_proven_sale_count,
  coalesce(sales.printing_not_identified_sale_count, 0) as printing_not_identified_sale_count
from public.manga_editions edition
left join evidence on evidence.edition_id = edition.id
left join profiles on profiles.edition_id = edition.id
left join runs on runs.edition_id = edition.id
left join sales on sales.edition_id = edition.id
left join pending_leads on pending_leads.edition_id = edition.id;

notify pgrst, 'reload schema';
