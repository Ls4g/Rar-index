-- Operational audit only: no evidence, decisions or source payloads.
create table public.cron_invocations (
  id uuid primary key,
  route text not null check (route in (
    '/api/cron/ebay-scout', '/api/cron/portfolio-snapshots',
    '/api/cron/rar-agents', '/api/cron/agent-reliability', '/api/cron/listing-outcomes'
  )),
  started_at timestamptz not null default now(),
  environment text not null default 'unknown' check (environment in ('production', 'preview', 'development', 'unknown')),
  commit_sha text check (commit_sha ~ '^[a-fA-F0-9]{40}$'),
  finished_at timestamptz,
  status text not null check (status in ('started', 'completed', 'partial', 'failed')),
  http_status integer check (http_status between 100 and 599),
  summary jsonb not null default '{}'::jsonb,
  check ((status = 'started' and finished_at is null and http_status is null)
    or (status <> 'started' and finished_at is not null and http_status is not null))
);
create index cron_invocations_route_started_idx on public.cron_invocations(route, started_at desc);
alter table public.cron_invocations enable row level security;
revoke all on public.cron_invocations from public, anon, authenticated;
grant select, insert, update on public.cron_invocations to service_role;
