-- RAR autonomy phase 2: the Market Scout may dismiss only leads whose
-- listing text contains an explicit, deterministic edition conflict.
--
-- Classification stays in application code so it can be regression-tested.
-- This function is deliberately narrower: it atomically applies supplied
-- dismissals only to untouched `new` leads and writes the normal Scout audit
-- row in the same transaction. It cannot watch or verify a listing, create a
-- price observation, or overwrite a human decision.

create or replace function public.apply_scout_agent_auto_dismiss(
  p_run_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied integer := 0;
begin
  if p_run_id is null or not exists (
    select 1
    from public.agent_runs
    where id = p_run_id
      and agent_key = 'market_scout'
      and status = 'running'
      and mode = 'safe_actions'
  ) then
    raise exception 'A running Market Scout safe-actions run is required';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 250 then
    raise exception 'Auto-dismiss accepts an array of at most 250 decisions';
  end if;

  with requested as materialized (
    select distinct on (item.lead_id)
      item.lead_id,
      left(nullif(trim(item.decision_notes), ''), 1000) as decision_notes
    from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as item(lead_id uuid, decision_notes text)
    where item.lead_id is not null
      and length(trim(coalesce(item.decision_notes, ''))) > 0
    order by item.lead_id
  ), updated as (
    update public.scout_listing_leads lead
    set review_status = 'dismissed',
        review_notes = requested.decision_notes,
        reviewed_by = 'RAR Market Scout',
        reviewed_at = now(),
        updated_at = now()
    from requested
    where lead.id = requested.lead_id
      and lead.review_status = 'new'
    returning lead.id, requested.decision_notes
  ), audited as (
    insert into public.scout_lead_decisions (
      lead_id, decision, decision_notes, reviewed_by
    )
    select id, 'dismissed', decision_notes, 'RAR Market Scout'
    from updated
    returning id
  )
  select count(*)::integer into v_applied from audited;

  return v_applied;
end;
$$;

revoke all on function public.apply_scout_agent_auto_dismiss(uuid, jsonb) from public;
grant execute on function public.apply_scout_agent_auto_dismiss(uuid, jsonb) to service_role;

update public.agent_system_control
set autonomy_level = greatest(autonomy_level, 2),
    updated_by = 'Phase 2 migration'
where singleton = true;

update public.agent_controls
set mode = 'safe_actions',
    schedule_label = 'Daily safe triage',
    mission = 'Dismiss definitive marketplace conflicts, then surface every plausible lead for human review.',
    updated_by = 'Phase 2 migration'
where agent_key = 'market_scout';

comment on function public.apply_scout_agent_auto_dismiss(uuid, jsonb) is
  'Atomically dismisses untouched Scout leads and writes normal audit rows. Requires a running Market Scout safe-actions run.';
