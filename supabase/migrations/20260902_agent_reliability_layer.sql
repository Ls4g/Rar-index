-- RAR Agent Reliability Layer
-- Additive, staff-only benchmark and evaluation history. Human decisions remain
-- the ground truth; this schema never grants an agent a publishing path.

create table if not exists public.agent_human_feedback (
  id uuid primary key default gen_random_uuid(),
  workflow text not null check (workflow in ('sale', 'printing', 'catalogue', 'cover', 'scout', 'agent_action')),
  subject_key text not null,
  outcome text not null,
  reason_label text,
  note text,
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists agent_human_feedback_subject_created_idx
  on public.agent_human_feedback(workflow, subject_key, created_at desc);

create table if not exists public.agent_benchmark_cases (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null check (agent_key in ('market_scout', 'catalogue_curator', 'evidence_auditor', 'rar_operator')),
  evaluator_key text not null,
  subject_key text not null,
  source_decision_table text not null,
  source_decision_id uuid not null,
  snapshot_hash text not null,
  input_snapshot jsonb not null,
  expected_outcome text not null,
  reason_label text,
  reviewed_by text not null,
  decided_at timestamptz not null,
  supersedes_case_id uuid references public.agent_benchmark_cases(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (source_decision_table, source_decision_id, snapshot_hash)
);

create index if not exists agent_benchmark_cases_evaluator_created_idx
  on public.agent_benchmark_cases(evaluator_key, created_at desc);
create index if not exists agent_benchmark_cases_subject_created_idx
  on public.agent_benchmark_cases(subject_key, decided_at desc, created_at desc);

create table if not exists public.agent_evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null check (agent_key in ('market_scout', 'catalogue_curator', 'evidence_auditor', 'rar_operator')),
  evaluator_key text not null,
  evaluator_version integer not null check (evaluator_version > 0),
  trigger_source text not null check (trigger_source in ('manual', 'schedule', 'changed_suite')),
  status text not null check (status in ('completed', 'failed')),
  case_count integer not null default 0,
  positive_count integer not null default 0,
  negative_count integer not null default 0,
  distinct_subjects integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  gates jsonb not null default '{}'::jsonb,
  passed boolean not null default false,
  regression_count integer not null default 0,
  initiated_by text not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists agent_evaluation_runs_evaluator_created_idx
  on public.agent_evaluation_runs(evaluator_key, created_at desc);

create table if not exists public.agent_evaluation_case_results (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null references public.agent_evaluation_runs(id) on delete restrict,
  benchmark_case_id uuid not null references public.agent_benchmark_cases(id) on delete restrict,
  expected_outcome text not null,
  predicted_outcome text not null,
  score numeric(7,4),
  passed boolean not null,
  critical_failure boolean not null default false,
  diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (evaluation_run_id, benchmark_case_id)
);

create index if not exists agent_evaluation_results_failures_idx
  on public.agent_evaluation_case_results(evaluation_run_id, critical_failure desc, passed);

alter table public.agent_human_feedback enable row level security;
alter table public.agent_benchmark_cases enable row level security;
alter table public.agent_evaluation_runs enable row level security;
alter table public.agent_evaluation_case_results enable row level security;

revoke all on public.agent_human_feedback from anon, authenticated;
revoke all on public.agent_benchmark_cases from anon, authenticated;
revoke all on public.agent_evaluation_runs from anon, authenticated;
revoke all on public.agent_evaluation_case_results from anon, authenticated;

create or replace function public.block_agent_reliability_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'Agent reliability history is append-only';
end;
$$;

drop trigger if exists agent_human_feedback_append_only on public.agent_human_feedback;
create trigger agent_human_feedback_append_only
before update or delete on public.agent_human_feedback
for each row execute function public.block_agent_reliability_mutation();

drop trigger if exists agent_benchmark_cases_append_only on public.agent_benchmark_cases;
create trigger agent_benchmark_cases_append_only
before update or delete on public.agent_benchmark_cases
for each row execute function public.block_agent_reliability_mutation();

drop trigger if exists agent_evaluation_runs_append_only on public.agent_evaluation_runs;
create trigger agent_evaluation_runs_append_only
before update or delete on public.agent_evaluation_runs
for each row execute function public.block_agent_reliability_mutation();

drop trigger if exists agent_evaluation_results_append_only on public.agent_evaluation_case_results;
create trigger agent_evaluation_results_append_only
before update or delete on public.agent_evaluation_case_results
for each row execute function public.block_agent_reliability_mutation();

alter table public.agent_action_events
  add column if not exists details jsonb not null default '{}'::jsonb;

comment on table public.agent_benchmark_cases is
  'Immutable snapshots of human-reviewed work used to test RAR agents without external API calls.';
comment on table public.agent_evaluation_runs is
  'Append-only reliability suite results. Passing a suite never activates or publishes anything automatically.';
