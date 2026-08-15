-- RAR autonomy phase 3: keep the Scout inbox current without treating an
-- unsuccessful API request as evidence that a listing ended.
--
-- The application checks a maximum of 25 stale eBay leads per run. This RPC
-- atomically records active/inconclusive checks and archives only conclusively
-- unavailable listings. Human decisions always win because every update is
-- restricted to rows whose review_status is still `new`.

alter table public.scout_listing_leads
  add column if not exists availability_checked_at timestamptz,
  add column if not exists availability_status text;

alter table public.scout_listing_leads
  drop constraint if exists scout_listing_leads_availability_status_check;

alter table public.scout_listing_leads
  add constraint scout_listing_leads_availability_status_check
  check (availability_status is null or availability_status in ('active', 'unavailable', 'inconclusive'));

create index if not exists scout_listing_leads_availability_queue_idx
  on public.scout_listing_leads (review_status, availability_checked_at, last_seen_at)
  where review_status = 'new';

create or replace function public.apply_scout_agent_availability_results(
  p_run_id uuid,
  p_active jsonb,
  p_unavailable jsonb,
  p_inconclusive jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active integer := 0;
  v_unavailable integer := 0;
  v_inconclusive integer := 0;
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

  if jsonb_typeof(coalesce(p_active, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_unavailable, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_inconclusive, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_active, '[]'::jsonb))
        + jsonb_array_length(coalesce(p_unavailable, '[]'::jsonb))
        + jsonb_array_length(coalesce(p_inconclusive, '[]'::jsonb)) > 25 then
    raise exception 'Availability refresh accepts arrays totalling at most 25 leads';
  end if;

  with requested as materialized (
    select distinct on (item.lead_id)
      item.lead_id,
      item.item_end_at,
      left(nullif(trim(item.decision_notes), ''), 1000) as decision_notes
    from jsonb_to_recordset(coalesce(p_active, '[]'::jsonb))
      as item(lead_id uuid, item_end_at timestamptz, decision_notes text)
    where item.lead_id is not null
    order by item.lead_id
  ), updated as (
    update public.scout_listing_leads lead
    set availability_status = 'active',
        availability_checked_at = now(),
        last_seen_at = now(),
        item_end_at = coalesce(requested.item_end_at, lead.item_end_at),
        updated_at = now()
    from requested
    where lead.id = requested.lead_id
      and lead.review_status = 'new'
    returning lead.id
  )
  select count(*)::integer into v_active from updated;

  with requested as materialized (
    select distinct on (item.lead_id)
      item.lead_id,
      item.item_end_at,
      left(nullif(trim(item.decision_notes), ''), 1000) as decision_notes
    from jsonb_to_recordset(coalesce(p_unavailable, '[]'::jsonb))
      as item(lead_id uuid, item_end_at timestamptz, decision_notes text)
    where item.lead_id is not null
      and length(trim(coalesce(item.decision_notes, ''))) > 0
    order by item.lead_id
  ), updated as (
    update public.scout_listing_leads lead
    set review_status = 'dismissed',
        review_notes = requested.decision_notes,
        reviewed_by = 'RAR Market Scout',
        reviewed_at = now(),
        availability_status = 'unavailable',
        availability_checked_at = now(),
        item_end_at = coalesce(requested.item_end_at, lead.item_end_at),
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
  select count(*)::integer into v_unavailable from audited;

  with requested as materialized (
    select distinct item.lead_id
    from jsonb_to_recordset(coalesce(p_inconclusive, '[]'::jsonb))
      as item(lead_id uuid, decision_notes text)
    where item.lead_id is not null
  ), updated as (
    update public.scout_listing_leads lead
    set availability_status = 'inconclusive',
        availability_checked_at = now(),
        updated_at = now()
    from requested
    where lead.id = requested.lead_id
      and lead.review_status = 'new'
    returning lead.id
  )
  select count(*)::integer into v_inconclusive from updated;

  return jsonb_build_object(
    'active', v_active,
    'unavailable', v_unavailable,
    'inconclusive', v_inconclusive
  );
end;
$$;

revoke all on function public.apply_scout_agent_availability_results(uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.apply_scout_agent_availability_results(uuid, jsonb, jsonb, jsonb) to service_role;

update public.agent_system_control
set autonomy_level = greatest(autonomy_level, 3),
    updated_by = 'Phase 3 migration'
where singleton = true;

update public.agent_controls
set mode = 'safe_actions',
    schedule_label = 'Daily conflict triage + availability refresh',
    mission = 'Archive definitive marketplace conflicts, recheck stale eBay listings, and surface a smaller current queue for human review.',
    updated_by = 'Phase 3 migration'
where agent_key = 'market_scout';

comment on function public.apply_scout_agent_availability_results(uuid, jsonb, jsonb, jsonb) is
  'Applies a bounded Market Scout availability refresh. Only conclusive unavailable results are dismissed and audited; human decisions remain race-protected.';
