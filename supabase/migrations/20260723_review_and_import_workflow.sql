-- RAR review workflow: decisions are recorded before price observations can affect market data.
create table if not exists public.price_review_decisions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.price_observations(id) on delete cascade,
  decision text not null check (decision in ('verified_match', 'needs_review', 'excluded')),
  decision_notes text not null check (length(trim(decision_notes)) >= 12),
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

alter table public.price_review_decisions enable row level security;
create index if not exists price_review_decisions_observation_created_idx
  on public.price_review_decisions(observation_id, created_at desc);

create or replace function public.apply_price_review(
  p_observation_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision not in ('verified_match', 'needs_review', 'excluded') then
    raise exception 'Invalid review decision';
  end if;
  if length(trim(coalesce(p_decision_notes, ''))) < 12 then
    raise exception 'Review notes must contain at least 12 characters';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Reviewer is required';
  end if;

  update public.price_observations
  set match_status = p_decision,
      is_verified = (p_decision = 'verified_match'),
      reviewed_at = now(),
      reviewed_by = trim(p_reviewed_by),
      notes = concat_ws(E'\n', notes, 'Review: ' || trim(p_decision_notes)),
      updated_at = now()
  where id = p_observation_id;

  if not found then
    raise exception 'Price observation % does not exist', p_observation_id;
  end if;

  insert into public.price_review_decisions (observation_id, decision, decision_notes, reviewed_by)
  values (p_observation_id, p_decision, trim(p_decision_notes), trim(p_reviewed_by));
end;
$$;

revoke all on function public.apply_price_review(uuid, text, text, text) from public;

-- Read-only validation view used before edition matching.
create or replace view public.import_readiness_queue
with (security_invoker = true)
as
select
  queue.*,
  array_remove(array[
    case when queue.source_id is null then 'missing_source' end,
    case when nullif(trim(queue.external_id), '') is null then 'missing_external_id' end,
    case when nullif(trim(queue.candidate_title), '') is null then 'missing_title' end,
    case when nullif(trim(queue.candidate_language), '') is null then 'missing_language' end,
    case when queue.raw_payload is null then 'missing_raw_payload' end
  ], null) as validation_issues,
  case
    when queue.status = 'approved'
      and queue.source_id is not null
      and nullif(trim(queue.external_id), '') is not null
      and nullif(trim(queue.candidate_title), '') is not null
      and nullif(trim(queue.candidate_language), '') is not null
      and queue.raw_payload is not null
      then 'ready_for_edition_match'
    when queue.status = 'approved' then 'needs_metadata'
    else 'not_ready'
  end as readiness
from public.import_queue queue;
