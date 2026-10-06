-- A human may revisit a lead they previously dismissed as graded. The
-- original dismissal and its label remain in scout_lead_decisions and
-- scout_decision_labels; the new decision is a separate audit event.
begin;

create or replace function public.revisit_graded_scout_lead(
  p_lead_id uuid,
  p_disposition text,
  p_reviewed_by text,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_external_id text;
  v_grade_decision_id uuid;
  v_latest_decision_id uuid;
  v_decision_id uuid;
  v_now timestamptz := now();
begin
  if p_disposition not in ('watching', 'dismissed') then
    raise exception 'Choose reopen in Scout or keep archived';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'A reviewer is required';
  end if;

  select review_status, external_id into v_status, v_external_id
  from public.scout_listing_leads
  where id = p_lead_id
  for update;
  if not found or v_status <> 'dismissed' then
    raise exception 'Only a currently dismissed Scout lead can be revisited';
  end if;

  select decision_id into v_grade_decision_id
  from public.scout_decision_labels
  where lead_id = p_lead_id and label = 'graded_not_raw'
  order by created_at desc, id desc
  limit 1;
  if v_grade_decision_id is null then
    raise exception 'This lead has no graded-copy dismissal to revisit';
  end if;

  select id into v_latest_decision_id
  from public.scout_lead_decisions
  where lead_id = p_lead_id
  order by created_at desc, id desc
  limit 1;
  if v_latest_decision_id is distinct from v_grade_decision_id then
    raise exception 'This graded-copy dismissal has already been revisited';
  end if;
  if p_disposition = 'watching' and exists (
    select 1 from public.listing_outcomes
    where external_id = v_external_id and status in ('unsold', 'review_complete')
  ) then
    raise exception 'This listing already has a final outcome; review that outcome before reopening it in Scout';
  end if;

  update public.scout_listing_leads
  set review_status = p_disposition,
      review_notes = nullif(trim(coalesce(p_notes, '')), ''),
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = v_now,
      last_seen_at = case
        -- Reopening means the human has just inspected the original listing
        -- and found it live. An archived decision makes no such claim.
        when p_disposition = 'watching' then greatest(last_seen_at, v_now)
        else last_seen_at
      end,
      updated_at = v_now
  where id = p_lead_id;

  insert into public.scout_lead_decisions
    (lead_id, decision, decision_notes, reviewed_by)
  values
    (p_lead_id, p_disposition,
     concat('Graded-copy revisit: ', case when p_disposition = 'watching'
       then 'reopened in Scout.' else 'kept archived.' end,
       case when length(trim(coalesce(p_notes, ''))) > 0 then ' ' || trim(p_notes) else '' end),
     trim(p_reviewed_by))
  returning id into v_decision_id;

  return v_decision_id;
end;
$$;

revoke all on function public.revisit_graded_scout_lead(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.revisit_graded_scout_lead(uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
