-- Correcting the grading on an already-verified sale ------------------------
--
-- Additive only: three nullable columns, one new append-only audit table, one
-- new function. No existing column, constraint, function or row is altered.
--
-- Why this exists. One verified observation carries "BGS 8.5" in its listing
-- title and empty grading columns:
--
--   ff81fb2f-201d-4ef1-85db-74171ae76b2a
--   "Hunter x Hunter #1 * BGS 8.5 - 1ST PRINTING * Japanese Manga 1998"
--   USD 2000, 2026-08-20, verified_match, confirmed
--
-- The other five verified sales on that edition are USD 42-149 raw copies. A
-- graded slab recorded as raw would sit in the raw comparison group and drag
-- every raw figure for that edition upwards by more than an order of
-- magnitude. `hasUnresolvedGrading()` already withholds it from raw
-- valuations and from price-series construction, so nothing is currently
-- wrong on any chart -- but withholding is a holding position, not a fix, and
-- until now there was no way for a human to resolve it at all. Correcting a
-- verified sale's grading was simply not a workflow RAR had.
--
-- What this deliberately does NOT do: infer the grade from the title. A title
-- is a conflict signal and never proof of a grading company or a grade. Only
-- a person who has opened the original listing can say what is in the slab,
-- and this function refuses to run unless they confirm they did.

alter table public.price_observations
  add column if not exists grading_reviewed_by text,
  add column if not exists grading_reviewed_at timestamptz,
  add column if not exists grading_review_notes text;

comment on column public.price_observations.grading_reviewed_at is
  'Set when a human opened the original source and stated whether this copy is raw or graded. Until then a listing title that mentions grading leaves the sale withheld from raw comparison groups.';

-- Append-only, like every other human decision trail in RAR, so a correction
-- can be inspected and argued with rather than merely trusted.
create table if not exists public.price_grading_decisions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.price_observations(id) on delete restrict,
  copy_type text not null check (copy_type in ('raw', 'graded')),
  grading_company text,
  grade_label text,
  previous_grading_company text,
  previous_grade_label text,
  listing_title text,
  source_listing_url text,
  decision_notes text,
  reviewed_by text not null check (length(trim(reviewed_by)) > 0),
  created_at timestamptz not null default now(),
  check ((copy_type = 'graded') = (grading_company is not null and grade_label is not null))
);

create index if not exists price_grading_decisions_observation_idx
  on public.price_grading_decisions(observation_id, created_at desc);

alter table public.price_grading_decisions enable row level security;
revoke all on public.price_grading_decisions from anon, authenticated;

drop trigger if exists price_grading_decisions_append_only on public.price_grading_decisions;
create trigger price_grading_decisions_append_only
before update or delete on public.price_grading_decisions
for each row execute function public.block_agent_reliability_mutation();

create or replace function public.record_observation_grading(
  p_observation_id uuid,
  p_copy_type text,
  p_grading_company text,
  p_grade_label text,
  p_source_confirmed boolean,
  p_decision_notes text,
  p_reviewed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_observation public.price_observations%rowtype;
  v_company text := nullif(upper(trim(coalesce(p_grading_company, ''))), '');
  v_grade text := nullif(trim(coalesce(p_grade_label, '')), '');
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
begin
  if v_reviewer is null then
    raise exception 'Add your name or initials so the correction is attributable.';
  end if;
  if p_copy_type not in ('raw', 'graded') then
    raise exception 'Say whether the copy in the original listing is raw or graded.';
  end if;
  -- The whole point of this workflow is that a person looked. Without that it
  -- would just be a slower way of believing the title.
  if p_source_confirmed is not true then
    raise exception 'Confirm that you opened the original listing and saw what the copy actually is.';
  end if;
  if p_copy_type = 'graded' and (v_company is null or v_grade is null) then
    raise exception 'A graded copy needs both the grading company and the exact grade.';
  end if;
  if p_copy_type = 'raw' and (v_company is not null or v_grade is not null) then
    raise exception 'A raw copy cannot carry a grading company or a grade.';
  end if;

  select * into v_observation from public.price_observations where id = p_observation_id for update;
  if not found then
    raise exception 'That sale no longer exists.';
  end if;

  -- Settled evidence is not rewritten here. This function exists only to
  -- resolve a sale whose grading is currently CONTRADICTORY -- one of the two
  -- grading columns filled, or a title mentioning grading with neither filled.
  -- A sale whose grading a human has already settled is changed through sale
  -- review, where the edition match is reconsidered at the same time.
  if v_observation.grading_reviewed_at is not null then
    raise exception 'The grading on this sale was already settled by % on %. Use sale review to reconsider it.',
      coalesce(v_observation.grading_reviewed_by, 'a colleague'),
      to_char(v_observation.grading_reviewed_at, 'DD Mon YYYY');
  end if;
  if (v_observation.grading_company is not null) = (v_observation.grade_label is not null)
     and v_observation.grading_company is not null then
    raise exception 'This sale already records a complete grade. Use sale review to change it.';
  end if;

  insert into public.price_grading_decisions (
    observation_id, copy_type, grading_company, grade_label,
    previous_grading_company, previous_grade_label,
    listing_title, source_listing_url, decision_notes, reviewed_by
  ) values (
    v_observation.id, p_copy_type, v_company, v_grade,
    v_observation.grading_company, v_observation.grade_label,
    v_observation.listing_title, v_observation.source_listing_url, v_notes, v_reviewer
  );

  update public.price_observations
     set grading_company = v_company,
         grade_label = v_grade,
         grading_reviewed_by = v_reviewer,
         grading_reviewed_at = now(),
         grading_review_notes = v_notes
   where id = v_observation.id
     and grading_reviewed_at is null;

  if not found then
    raise exception 'This sale changed while the correction was being saved. Refresh and retry; nothing was written.';
  end if;

  insert into public.agent_human_feedback (
    workflow, subject_key, outcome, reason_label, note, reviewed_by
  ) values (
    'sale', 'grading:' || v_observation.id::text,
    case when p_copy_type = 'graded' then 'graded_confirmed' else 'raw_confirmed' end,
    'grading_corrected', v_notes, v_reviewer
  );

  return jsonb_build_object(
    'ok', true,
    'observationId', v_observation.id,
    'copyType', p_copy_type,
    'gradingCompany', v_company,
    'gradeLabel', v_grade
  );
end;
$$;

revoke all on function public.record_observation_grading(uuid, text, text, text, boolean, text, text) from public;
grant execute on function public.record_observation_grading(uuid, text, text, text, boolean, text, text) to service_role;

comment on function public.record_observation_grading(uuid, text, text, text, boolean, text, text) is
  'Records what a human saw in the original listing for a sale whose grading is contradictory. Refuses to run without an explicit source confirmation, never infers a grade from a listing title, and never rewrites grading a human has already settled.';

comment on table public.price_grading_decisions is
  'Append-only human corrections to the grading recorded on a completed sale, including what the sale said before.';

notify pgrst, 'reload schema';
