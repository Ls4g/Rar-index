-- A collection run is the accountable record of checking one exact marketplace
-- search profile. It does not import or verify listings by itself.
create table if not exists public.marketplace_collection_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.marketplace_search_profiles(id) on delete restrict,
  checked_at timestamptz not null default now(),
  checked_by text not null check (length(trim(checked_by)) > 0),
  candidate_count integer not null check (candidate_count >= 0),
  notes text not null check (length(trim(notes)) >= 3),
  created_at timestamptz not null default now()
);

create index if not exists marketplace_collection_runs_profile_checked_idx
  on public.marketplace_collection_runs(profile_id, checked_at desc);

alter table public.price_observations
  add column if not exists collection_run_id uuid references public.marketplace_collection_runs(id) on delete restrict;

create index if not exists price_observations_collection_run_idx
  on public.price_observations(collection_run_id)
  where collection_run_id is not null;

alter table public.marketplace_collection_runs enable row level security;
