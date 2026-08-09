-- Foundation for a public collector username: a signed-in user can claim one
-- handle, shown publicly (this table holds nothing but the handle itself --
-- no holdings, no purchase data, nothing private), while every other part of
-- their account stays exactly as private as it already was. Purely
-- additive: a new table, a new trigger, new RLS policies. Nothing existing
-- (portfolio_holdings, portfolio_snapshots, price_observations, Scout, auth)
-- is touched.
create table if not exists public.collector_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  -- Case-insensitive uniqueness ("RAR" and "rar" are the same handle) while
  -- the user's chosen capitalisation is still preserved for display.
  username_key text generated always as (lower(username)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collector_profiles_username_format
    check (username ~ '^[A-Za-z0-9][A-Za-z0-9_]{2,19}$'),
  constraint collector_profiles_username_key_unique unique (username_key)
);

create index if not exists collector_profiles_username_key_idx
  on public.collector_profiles(username_key);

-- Route paths and generic terms that must never be claimable as a username,
-- since a future public profile page is expected to live at a path built
-- from the handle (e.g. /collectors/{username}) and would otherwise collide
-- with real app routes or read as an official/system account.
create or replace function public.reject_reserved_collector_username()
returns trigger
language plpgsql
as $$
begin
  if new.username_key = any (array[
    'admin','administrator','staff','support','help','about','contact',
    'null','undefined','root','rar','index','www','home','login','logout',
    'signin','signup','sign-in','sign-up','settings','setting','profile','profiles',
    'user','users','moderator','mod','system','security','terms','privacy',
    'legal','api','me','you','collector','collectors',
    'add-sale','browse','catalogue-import','catalogue-requests',
    'catalogue-review','collection-profiles','community-reports','cover-review',
    'coverage-dashboard','data-readiness','edition','identify','portfolio',
    'price-import','request-edition','review','scout','staff-login'
  ]) then
    raise exception 'This username is reserved and cannot be used.';
  end if;
  return new;
end;
$$;

drop trigger if exists collector_profiles_reject_reserved on public.collector_profiles;
create trigger collector_profiles_reject_reserved
  before insert or update on public.collector_profiles
  for each row execute function public.reject_reserved_collector_username();

alter table public.collector_profiles enable row level security;

-- The whole point of this table is a handle other people can see, so
-- select is open to everyone -- there is nothing sensitive in it to guard.
-- Only the owner can claim or change their own row.
create policy "Anyone can read collector usernames"
  on public.collector_profiles for select
  using (true);

create policy "Users can claim their own collector username"
  on public.collector_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can change their own collector username"
  on public.collector_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can release their own collector username"
  on public.collector_profiles for delete
  using (auth.uid() = user_id);

-- No public profile page exists yet -- this migration and the claim/edit UI
-- built alongside it are the foundation only. Deciding what a public
-- collector page actually shows (which holdings if any, evidence, etc.) is
-- a separate, deliberately not-yet-built next step.
