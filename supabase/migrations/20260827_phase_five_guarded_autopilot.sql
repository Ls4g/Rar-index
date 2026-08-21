-- RAR autonomy phase 5: guarded operating cycles and exception-first control.
--
-- A cycle may run the four existing agents and their already-approved safe
-- actions. It still cannot verify a sale, classify a printing, approve a
-- cover, or publish a catalogue record. Repeated technical failures trip the
-- global kill switch and leave an auditable incident for staff.

alter table public.agent_system_control
  add column if not exists consecutive_failed_cycles integer not null default 0 check (consecutive_failed_cycles >= 0),
  add column if not exists failure_threshold smallint not null default 2 check (failure_threshold between 1 and 10),
  add column if not exists auto_pause_on_failure boolean not null default true,
  add column if not exists last_cycle_at timestamptz,
  add column if not exists last_healthy_cycle_at timestamptz,
  add column if not exists circuit_breaker_reason text;

create table if not exists public.agent_cycles (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null check (trigger_source in ('manual', 'schedule', 'system')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'degraded', 'failed', 'blocked')),
  initiated_by text not null check (length(trim(initiated_by)) > 0),
  total_agents smallint not null default 4 check (total_agents > 0),
  successful_agents smallint not null default 0 check (successful_agents >= 0),
  failed_agents smallint not null default 0 check (failed_agents >= 0),
  blocked_agents smallint not null default 0 check (blocked_agents >= 0),
  summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_cycles_started_idx
  on public.agent_cycles(started_at desc);

alter table public.agent_runs
  add column if not exists cycle_id uuid references public.agent_cycles(id) on delete set null;

create index if not exists agent_runs_cycle_idx
  on public.agent_runs(cycle_id, started_at);

create table if not exists public.agent_incidents (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid references public.agent_cycles(id) on delete set null,
  incident_key text not null,
  incident_type text not null check (incident_type in ('agent_failure', 'circuit_breaker', 'rule_regression', 'data_integrity')),
  severity text not null check (severity in ('warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  title text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution_notes text
);

create unique index if not exists agent_incidents_one_open_key_idx
  on public.agent_incidents(incident_key)
  where status = 'open';
create index if not exists agent_incidents_status_created_idx
  on public.agent_incidents(status, created_at desc);

create table if not exists public.agent_incident_events (
  id bigint generated always as identity primary key,
  incident_id uuid not null references public.agent_incidents(id) on delete restrict,
  previous_status text,
  next_status text not null,
  actor text not null,
  notes text,
  created_at timestamptz not null default now()
);

create or replace function public.touch_agent_incident_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_incidents_touch_updated_at on public.agent_incidents;
create trigger agent_incidents_touch_updated_at
before update on public.agent_incidents
for each row execute function public.touch_agent_incident_updated_at();

create or replace function public.record_agent_incident_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.agent_incident_events (incident_id, previous_status, next_status, actor, notes)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status else null end,
      new.status,
      coalesce(nullif(trim(new.resolved_by), ''), 'RAR Operator'),
      new.resolution_notes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists agent_incidents_record_event on public.agent_incidents;
create trigger agent_incidents_record_event
after insert or update of status on public.agent_incidents
for each row execute function public.record_agent_incident_event();

create or replace function public.block_agent_incident_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Agent incident history is append-only';
end;
$$;

drop trigger if exists agent_incident_events_append_only on public.agent_incident_events;
create trigger agent_incident_events_append_only
before update or delete on public.agent_incident_events
for each row execute function public.block_agent_incident_event_mutation();

create or replace function public.finish_agent_cycle(
  p_cycle_id uuid,
  p_successful_agents integer,
  p_failed_agents integer,
  p_blocked_agents integer,
  p_summary text,
  p_actor text
)
returns table(cycle_status text, circuit_breaker_tripped boolean, consecutive_failures integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cycle public.agent_cycles%rowtype;
  v_control public.agent_system_control%rowtype;
  v_status text;
  v_failures integer;
  v_trip boolean := false;
  v_actor text := coalesce(nullif(trim(p_actor), ''), 'RAR Operator');
begin
  select * into v_cycle from public.agent_cycles where id = p_cycle_id for update;
  if v_cycle.id is null then raise exception 'Agent cycle was not found'; end if;
  if v_cycle.status <> 'running' then raise exception 'Agent cycle is already complete'; end if;
  if least(p_successful_agents, p_failed_agents, p_blocked_agents) < 0 then raise exception 'Agent counts cannot be negative'; end if;
  if p_successful_agents + p_failed_agents + p_blocked_agents <> v_cycle.total_agents then raise exception 'Agent counts must equal the cycle total'; end if;

  v_status := case
    when p_failed_agents = v_cycle.total_agents then 'failed'
    when p_failed_agents > 0 then 'degraded'
    when p_blocked_agents = v_cycle.total_agents then 'blocked'
    when p_blocked_agents > 0 then 'degraded'
    else 'succeeded'
  end;

  update public.agent_cycles set
    status = v_status,
    successful_agents = p_successful_agents,
    failed_agents = p_failed_agents,
    blocked_agents = p_blocked_agents,
    summary = p_summary,
    finished_at = now()
  where id = p_cycle_id;

  select * into v_control from public.agent_system_control where singleton = true for update;
  v_failures := case
    when p_failed_agents > 0 then v_control.consecutive_failed_cycles + 1
    when v_status = 'succeeded' then 0
    else v_control.consecutive_failed_cycles
  end;
  v_trip := p_failed_agents > 0
    and v_control.auto_pause_on_failure
    and v_failures >= v_control.failure_threshold;

  update public.agent_system_control set
    autonomy_level = greatest(autonomy_level, 5),
    consecutive_failed_cycles = v_failures,
    last_cycle_at = now(),
    last_healthy_cycle_at = case when v_status = 'succeeded' then now() else last_healthy_cycle_at end,
    global_paused = case when v_trip then true else global_paused end,
    pause_reason = case when v_trip then 'Phase 5 circuit breaker: repeated agent-cycle failures' else pause_reason end,
    circuit_breaker_reason = case when v_trip then p_summary when v_status = 'succeeded' then null else circuit_breaker_reason end,
    updated_by = v_actor
  where singleton = true;

  if p_failed_agents > 0 then
    insert into public.agent_incidents (cycle_id, incident_key, incident_type, severity, title, details)
    values (
      p_cycle_id,
      'agent-cycle-failures',
      'agent_failure',
      case when v_trip then 'critical' else 'warning' end,
      case when v_trip then 'Repeated agent failures paused RAR automation' else 'An agent cycle needs inspection' end,
      jsonb_build_object('summary', p_summary, 'failed_agents', p_failed_agents, 'consecutive_failures', v_failures)
    )
    on conflict (incident_key) where status = 'open' do update set
      cycle_id = excluded.cycle_id,
      severity = excluded.severity,
      title = excluded.title,
      details = excluded.details;
  elsif v_status = 'succeeded' then
    update public.agent_incidents set
      status = 'resolved',
      resolved_by = 'RAR Operator',
      resolved_at = now(),
      resolution_notes = 'Resolved automatically after a fully healthy agent cycle.'
    where incident_key = 'agent-cycle-failures' and status = 'open';
  end if;

  if v_trip then
    insert into public.agent_incidents (cycle_id, incident_key, incident_type, severity, title, details)
    values (
      p_cycle_id,
      'agent-circuit-breaker',
      'circuit_breaker',
      'critical',
      'RAR automation circuit breaker is active',
      jsonb_build_object('summary', p_summary, 'threshold', v_control.failure_threshold, 'consecutive_failures', v_failures)
    )
    on conflict (incident_key) where status = 'open' do update set
      cycle_id = excluded.cycle_id,
      details = excluded.details;
  end if;

  return query select v_status, v_trip, v_failures;
end;
$$;

create or replace function public.resolve_agent_incident(
  p_incident_id uuid,
  p_resolved_by text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := trim(coalesce(p_resolved_by, ''));
begin
  if v_actor = '' then raise exception 'Staff name is required'; end if;
  update public.agent_incidents set
    status = 'resolved',
    resolved_by = v_actor,
    resolved_at = now(),
    resolution_notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_incident_id and status = 'open';
  if not found then raise exception 'Open incident was not found'; end if;
end;
$$;

alter table public.agent_cycles enable row level security;
alter table public.agent_incidents enable row level security;
alter table public.agent_incident_events enable row level security;
revoke all on public.agent_cycles from anon, authenticated;
revoke all on public.agent_incidents from anon, authenticated;
revoke all on public.agent_incident_events from anon, authenticated;
revoke all on function public.finish_agent_cycle(uuid, integer, integer, integer, text, text) from public;
revoke all on function public.resolve_agent_incident(uuid, text, text) from public;
grant execute on function public.finish_agent_cycle(uuid, integer, integer, integer, text, text) to service_role;
grant execute on function public.resolve_agent_incident(uuid, text, text) to service_role;

update public.agent_system_control
set autonomy_level = greatest(autonomy_level, 5),
    updated_by = 'Phase 5 guarded autopilot migration'
where singleton = true;

update public.agent_controls
set mode = 'safe_actions',
    mission = 'Monitor guarded operating cycles, surface exceptions and protect RAR with the circuit breaker.',
    schedule_label = 'Daily guarded cycle',
    updated_by = 'Phase 5 guarded autopilot migration'
where agent_key = 'rar_operator';

comment on table public.agent_cycles is 'One auditable four-agent operating cycle. Cycles never bypass domain review workflows.';
comment on table public.agent_incidents is 'Exception-first staff queue for agent failures, safety stops and detected regressions.';
comment on table public.agent_incident_events is 'Append-only incident status audit history.';
