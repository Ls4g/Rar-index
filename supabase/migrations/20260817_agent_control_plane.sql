-- RAR autonomy control plane, phase 1.
--
-- Agents begin in observation mode. They may inspect RAR data and write
-- proposals into these tables, but this migration grants them no path to
-- mutate catalogue records, prices, covers, Scout decisions, or portfolios.

create table if not exists public.agent_system_control (
  singleton boolean primary key default true check (singleton),
  global_paused boolean not null default false,
  pause_reason text,
  autonomy_level smallint not null default 1 check (autonomy_level between 1 and 5),
  updated_by text,
  updated_at timestamptz not null default now()
);

insert into public.agent_system_control (singleton)
values (true)
on conflict (singleton) do nothing;

create table if not exists public.agent_controls (
  agent_key text primary key check (agent_key in ('catalogue_curator', 'market_scout', 'evidence_auditor', 'rar_operator')),
  display_name text not null,
  mission text not null,
  mode text not null default 'observe' check (mode in ('observe', 'prepare', 'safe_actions', 'publish_high_confidence')),
  is_paused boolean not null default false,
  schedule_label text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.agent_controls (agent_key, display_name, mission, schedule_label)
values
  ('catalogue_curator', 'Catalogue Curator', 'Find catalogue and cover gaps, then prepare exact-edition research work.', 'Daily observation'),
  ('market_scout', 'Market Scout', 'Measure marketplace coverage and identify the highest-value Scout backlog.', 'Daily observation'),
  ('evidence_auditor', 'Evidence Auditor', 'Find sales and printing evidence that still needs an accountable decision.', 'Daily observation'),
  ('rar_operator', 'RAR Operator', 'Summarise operational bottlenecks and decide what RAR should work on next.', 'Daily observation')
on conflict (agent_key) do update set
  display_name = excluded.display_name,
  mission = excluded.mission,
  schedule_label = excluded.schedule_label;

create table if not exists public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null references public.agent_controls(agent_key),
  trigger_source text not null check (trigger_source in ('manual', 'schedule', 'system')),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'blocked')),
  mode text not null check (mode in ('observe', 'prepare', 'safe_actions', 'publish_high_confidence')),
  initiated_by text not null,
  summary text,
  metrics jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists agent_runs_agent_started_idx
  on public.agent_runs(agent_key, started_at desc);
create index if not exists agent_runs_status_started_idx
  on public.agent_runs(status, started_at desc);

create table if not exists public.agent_actions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.agent_runs(id) on delete restrict,
  agent_key text not null references public.agent_controls(agent_key),
  action_type text not null,
  target_type text not null,
  target_id text,
  dedupe_key text not null,
  title text not null,
  rationale text not null,
  risk_level text not null default 'low' check (risk_level in ('low', 'medium', 'high')),
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'executed', 'cancelled')),
  evidence jsonb not null default '{}'::jsonb,
  proposed_payload jsonb not null default '{}'::jsonb,
  reviewed_by text,
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  executed_at timestamptz
);

create unique index if not exists agent_actions_open_dedupe_idx
  on public.agent_actions(dedupe_key)
  where status in ('proposed', 'approved');
create index if not exists agent_actions_status_created_idx
  on public.agent_actions(status, created_at desc);
create index if not exists agent_actions_agent_created_idx
  on public.agent_actions(agent_key, created_at desc);

create table if not exists public.agent_action_events (
  id bigint generated always as identity primary key,
  action_id uuid not null references public.agent_actions(id) on delete restrict,
  previous_status text,
  next_status text not null,
  actor text not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists agent_action_events_action_created_idx
  on public.agent_action_events(action_id, created_at desc);

create or replace function public.record_agent_action_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.agent_action_events (
      action_id, previous_status, next_status, actor, notes
    ) values (
      new.id,
      case when tg_op = 'UPDATE' then old.status else null end,
      new.status,
      coalesce(nullif(trim(new.reviewed_by), ''), 'RAR Agent System'),
      new.review_notes
    );
  end if;
  return new;
end;
$$;

drop trigger if exists agent_actions_record_event on public.agent_actions;
create trigger agent_actions_record_event
after insert or update of status on public.agent_actions
for each row execute function public.record_agent_action_event();

create or replace function public.touch_agent_control_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_controls_touch_updated_at on public.agent_controls;
create trigger agent_controls_touch_updated_at
before update on public.agent_controls
for each row execute function public.touch_agent_control_updated_at();

drop trigger if exists agent_system_control_touch_updated_at on public.agent_system_control;
create trigger agent_system_control_touch_updated_at
before update on public.agent_system_control
for each row execute function public.touch_agent_control_updated_at();

alter table public.agent_system_control enable row level security;
alter table public.agent_controls enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_actions enable row level security;
alter table public.agent_action_events enable row level security;

revoke all on public.agent_system_control from anon, authenticated;
revoke all on public.agent_controls from anon, authenticated;
revoke all on public.agent_runs from anon, authenticated;
revoke all on public.agent_actions from anon, authenticated;
revoke all on public.agent_action_events from anon, authenticated;

comment on table public.agent_system_control is 'Global autonomy level and emergency stop. Staff/service-role only.';
comment on table public.agent_controls is 'Per-agent mode and pause state. Phase 1 agents remain observation-only.';
comment on table public.agent_runs is 'One auditable operational record per manual or scheduled agent run.';
comment on table public.agent_actions is 'Agent proposals. A proposal never mutates the underlying RAR domain record by itself.';
comment on table public.agent_action_events is 'Append-only status history for every proposed agent action.';
