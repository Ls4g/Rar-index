-- Anonymous, aggregate-only journey counters. No search text, URLs, IPs,
-- user IDs, cookies, or sale/valuation evidence is stored here.
create table if not exists public.public_journey_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('catalogue_search', 'edition_view', 'shelf_add', 'listing_click')),
  created_at timestamptz not null default now()
);

create index if not exists public_journey_events_created_type_idx
  on public.public_journey_events (created_at desc, event_type);

alter table public.public_journey_events enable row level security;
revoke all on public.public_journey_events from public, anon, authenticated;
grant select, insert on public.public_journey_events to service_role;
