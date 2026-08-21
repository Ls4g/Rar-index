-- RAR autonomy phase 4: versioned, human-approved Scout scoring rules.
--
-- Learned rules can only adjust lead scores. They cannot verify a sale,
-- publish an edition, overwrite a human decision, or create a new automatic
-- dismissal path. Every evaluation and status transition remains auditable.

create table if not exists public.scout_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null,
  version integer not null check (version > 0),
  rule_type text not null check (rule_type in (
    'first_print_proof', 'multi_volume_phrase', 'edition_conflict_phrase'
  )),
  config jsonb not null default '{}'::jsonb,
  status text not null default 'candidate' check (status in (
    'candidate', 'shadow_passed', 'active', 'superseded', 'rejected'
  )),
  source_action_id uuid references public.agent_actions(id) on delete set null,
  evaluation_metrics jsonb not null default '{}'::jsonb,
  created_by text not null check (length(trim(created_by)) > 0),
  approved_by text,
  created_at timestamptz not null default now(),
  tested_at timestamptz,
  activated_at timestamptz,
  superseded_at timestamptz,
  unique (rule_key, version)
);

create unique index if not exists scout_rule_versions_one_active_idx
  on public.scout_rule_versions(rule_key)
  where status = 'active';

create index if not exists scout_rule_versions_status_created_idx
  on public.scout_rule_versions(status, created_at desc);

create table if not exists public.scout_rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.scout_rule_versions(id) on delete restrict,
  baseline_metrics jsonb not null default '{}'::jsonb,
  candidate_metrics jsonb not null default '{}'::jsonb,
  gates jsonb not null default '{}'::jsonb,
  examples jsonb not null default '[]'::jsonb,
  passed boolean not null,
  evaluated_by text not null check (length(trim(evaluated_by)) > 0),
  evaluated_at timestamptz not null default now()
);

create index if not exists scout_rule_evaluations_rule_created_idx
  on public.scout_rule_evaluations(rule_version_id, evaluated_at desc);

create table if not exists public.scout_rule_events (
  id uuid primary key default gen_random_uuid(),
  rule_version_id uuid not null references public.scout_rule_versions(id) on delete restrict,
  event_type text not null,
  actor text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists scout_rule_events_rule_created_idx
  on public.scout_rule_events(rule_version_id, created_at desc);

create or replace function public.block_scout_rule_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Scout rule audit history is append-only';
end;
$$;

drop trigger if exists scout_rule_evaluations_append_only on public.scout_rule_evaluations;
create trigger scout_rule_evaluations_append_only
before update or delete on public.scout_rule_evaluations
for each row execute function public.block_scout_rule_audit_mutation();

drop trigger if exists scout_rule_events_append_only on public.scout_rule_events;
create trigger scout_rule_events_append_only
before update or delete on public.scout_rule_events
for each row execute function public.block_scout_rule_audit_mutation();

create or replace function public.record_scout_rule_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.scout_rule_events (rule_version_id, event_type, actor, details)
    values (new.id, 'created', new.created_by, jsonb_build_object('status', new.status));
  elsif old.status is distinct from new.status then
    insert into public.scout_rule_events (rule_version_id, event_type, actor, details)
    values (
      new.id,
      new.status,
      coalesce(nullif(trim(new.approved_by), ''), new.created_by),
      jsonb_build_object('from', old.status, 'to', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists scout_rule_versions_record_event on public.scout_rule_versions;
create trigger scout_rule_versions_record_event
after insert or update of status on public.scout_rule_versions
for each row execute function public.record_scout_rule_event();

create or replace function public.apply_historical_scout_label(
  p_decision_id uuid,
  p_label text,
  p_created_by text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision public.scout_lead_decisions%rowtype;
  v_id uuid;
  v_actor text := trim(coalesce(p_created_by, ''));
begin
  if v_actor = '' then raise exception 'Staff name is required'; end if;

  select * into v_decision
  from public.scout_lead_decisions
  where id = p_decision_id;

  if v_decision.id is null then raise exception 'Scout decision was not found'; end if;
  if v_decision.reviewed_by in ('RAR Market Scout', 'RAR Auto-Triage', 'RAR Market Scout system')
     or v_decision.reviewed_by like '% system' then
    raise exception 'Automated decisions cannot be used as human learning evidence';
  end if;

  if p_label not in (
    'exact_match', 'interesting_opportunity', 'edition_mismatch',
    'printing_unproven', 'graded_not_raw', 'multi_volume_lot',
    'duplicate_listing', 'unavailable', 'poor_value',
    'other_watch', 'other_dismiss'
  ) then raise exception 'Invalid Scout learning label'; end if;

  if v_decision.decision = 'watching' and p_label not in (
    'exact_match', 'interesting_opportunity', 'other_watch'
  ) then raise exception 'This label does not describe a Watch decision'; end if;

  if v_decision.decision = 'dismissed' and p_label not in (
    'edition_mismatch', 'printing_unproven', 'graded_not_raw',
    'multi_volume_lot', 'duplicate_listing', 'unavailable',
    'poor_value', 'other_dismiss'
  ) then raise exception 'This label does not describe a Dismiss decision'; end if;

  insert into public.scout_decision_labels (decision_id, lead_id, label, created_by)
  values (v_decision.id, v_decision.lead_id, p_label, v_actor)
  on conflict (decision_id) do nothing
  returning id into v_id;

  if v_id is null then raise exception 'This decision already has a learning label'; end if;
  return v_id;
end;
$$;

create or replace function public.activate_scout_rule_version(
  p_rule_version_id uuid,
  p_approved_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.scout_rule_versions%rowtype;
  v_actor text := trim(coalesce(p_approved_by, ''));
begin
  if v_actor = '' then raise exception 'Staff name is required'; end if;
  select * into v_rule from public.scout_rule_versions where id = p_rule_version_id for update;
  if v_rule.id is null then raise exception 'Rule version was not found'; end if;
  if v_rule.status <> 'shadow_passed' then raise exception 'Only a passing shadow rule can be activated'; end if;
  if not exists (
    select 1 from public.scout_rule_evaluations
    where rule_version_id = v_rule.id and passed = true
  ) then raise exception 'A passing shadow evaluation is required'; end if;

  update public.scout_rule_versions
  set status = 'superseded', superseded_at = now(), approved_by = v_actor
  where rule_key = v_rule.rule_key and status = 'active';

  update public.scout_rule_versions
  set status = 'active', approved_by = v_actor, activated_at = now(), superseded_at = null
  where id = v_rule.id and status = 'shadow_passed';
end;
$$;

create or replace function public.rollback_scout_rule_version(
  p_target_rule_version_id uuid,
  p_approved_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target public.scout_rule_versions%rowtype;
  v_actor text := trim(coalesce(p_approved_by, ''));
begin
  if v_actor = '' then raise exception 'Staff name is required'; end if;
  select * into v_target from public.scout_rule_versions where id = p_target_rule_version_id for update;
  if v_target.id is null then raise exception 'Rollback version was not found'; end if;
  if v_target.status <> 'superseded' then raise exception 'Only a superseded rule can be restored'; end if;

  update public.scout_rule_versions
  set status = 'superseded', superseded_at = now(), approved_by = v_actor
  where rule_key = v_target.rule_key and status = 'active';

  update public.scout_rule_versions
  set status = 'active', approved_by = v_actor, activated_at = now(), superseded_at = null
  where id = v_target.id and status = 'superseded';
end;
$$;

alter table public.scout_rule_versions enable row level security;
alter table public.scout_rule_evaluations enable row level security;
alter table public.scout_rule_events enable row level security;

revoke all on public.scout_rule_versions from anon, authenticated;
revoke all on public.scout_rule_evaluations from anon, authenticated;
revoke all on public.scout_rule_events from anon, authenticated;
revoke all on function public.apply_historical_scout_label(uuid, text, text) from public;
revoke all on function public.activate_scout_rule_version(uuid, text) from public;
revoke all on function public.rollback_scout_rule_version(uuid, text) from public;
grant execute on function public.apply_historical_scout_label(uuid, text, text) to service_role;
grant execute on function public.activate_scout_rule_version(uuid, text) to service_role;
grant execute on function public.rollback_scout_rule_version(uuid, text) to service_role;

comment on table public.scout_rule_versions is
  'Versioned, staff-approved Scout score adjustments. Active rules never verify or dismiss a lead.';
comment on table public.scout_rule_evaluations is
  'Immutable shadow-test results comparing candidate Scout rules with labelled human decisions.';
comment on table public.scout_rule_events is
  'Append-only audit history for Scout rule creation, testing, activation and rollback.';
