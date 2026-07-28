-- Assisted collection cadence: this creates a human reminder signal only.
-- It does not scrape, query marketplaces, or import any sale automatically.
alter table public.marketplace_search_profiles
  add column if not exists collection_interval_days integer not null default 7
  check (collection_interval_days between 1 and 365);
