-- RAR autonomy phase 3: optional structured reasons for human Scout
-- decisions. These labels are training/evaluation evidence only. They never
-- alter a lead, verify a sale, or change the production scorer.

create table if not exists public.scout_decision_labels (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null unique references public.scout_lead_decisions(id) on delete cascade,
  lead_id uuid not null references public.scout_listing_leads(id) on delete cascade,
  label text not null check (label in (
    'exact_match',
    'interesting_opportunity',
    'edition_mismatch',
    'printing_unproven',
    'graded_not_raw',
    'multi_volume_lot',
    'duplicate_listing',
    'unavailable',
    'poor_value',
    'other_watch',
    'other_dismiss'
  )),
  created_by text not null check (length(trim(created_by)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists scout_decision_labels_label_created_idx
  on public.scout_decision_labels(label, created_at desc);

alter table public.scout_decision_labels enable row level security;

comment on table public.scout_decision_labels is
  'Optional human reasons attached to Scout decisions for shadow evaluation. Labels never change production rules automatically.';

create or replace function public.apply_scout_lead_decision_with_label(
  p_lead_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text,
  p_learning_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision_id uuid;
  v_label text := nullif(trim(coalesce(p_learning_label, '')), '');
begin
  if v_label is not null and v_label not in (
    'exact_match', 'interesting_opportunity', 'edition_mismatch',
    'printing_unproven', 'graded_not_raw', 'multi_volume_lot',
    'duplicate_listing', 'unavailable', 'poor_value',
    'other_watch', 'other_dismiss'
  ) then
    raise exception 'Invalid Scout learning label';
  end if;

  if p_decision = 'watching' and v_label is not null and v_label not in (
    'exact_match', 'interesting_opportunity', 'other_watch'
  ) then
    raise exception 'This learning label does not describe a Watch decision';
  end if;

  if p_decision = 'dismissed' and v_label is not null and v_label not in (
    'edition_mismatch', 'printing_unproven', 'graded_not_raw',
    'multi_volume_lot', 'duplicate_listing', 'unavailable',
    'poor_value', 'other_dismiss'
  ) then
    raise exception 'This learning label does not describe a Dismiss decision';
  end if;

  perform public.apply_scout_lead_decision(
    p_lead_id,
    p_decision,
    p_decision_notes,
    p_reviewed_by
  );

  select id into v_decision_id
  from public.scout_lead_decisions
  where lead_id = p_lead_id
    and decision = p_decision
    and reviewed_by = trim(p_reviewed_by)
  order by created_at desc
  limit 1;

  if v_decision_id is null then
    raise exception 'The Scout decision audit row could not be found';
  end if;

  if v_label is not null then
    insert into public.scout_decision_labels (
      decision_id, lead_id, label, created_by
    ) values (
      v_decision_id, p_lead_id, v_label, trim(p_reviewed_by)
    );
  end if;

  return v_decision_id;
end;
$$;

revoke all on function public.apply_scout_lead_decision_with_label(uuid, text, text, text, text) from public;

