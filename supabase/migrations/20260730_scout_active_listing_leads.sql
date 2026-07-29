-- Scout captures active marketplace leads only. It never creates price observations.
create table if not exists public.scout_scans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.marketplace_search_profiles(id) on delete cascade,
  provider text not null check (provider in ('ebay_browse')),
  status text not null check (status in ('completed', 'failed')),
  result_count integer not null default 0 check (result_count >= 0),
  error_message text,
  scanned_at timestamptz not null default now()
);

create table if not exists public.scout_listing_leads (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.marketplace_search_profiles(id) on delete cascade,
  source_id uuid not null references public.sources(id),
  external_id text not null,
  source_listing_url text not null,
  listing_title text not null,
  listing_price numeric,
  currency text,
  listing_condition text,
  item_end_at timestamptz,
  match_assessment jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

create index if not exists scout_listing_leads_profile_seen_idx
  on public.scout_listing_leads(profile_id, last_seen_at desc);
create index if not exists scout_scans_profile_scanned_idx
  on public.scout_scans(profile_id, scanned_at desc);

alter table public.scout_scans enable row level security;
alter table public.scout_listing_leads enable row level security;
