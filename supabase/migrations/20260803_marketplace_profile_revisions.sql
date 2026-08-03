-- A search profile is operational evidence. Edits must remain visible so a
-- later reviewer can tell which query applied to an earlier collection run.
create table if not exists public.marketplace_profile_revisions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.marketplace_search_profiles(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by text not null check (length(trim(changed_by)) > 0),
  change_note text not null check (length(trim(change_note)) >= 8),
  previous_search_query text not null,
  previous_scope_notes text not null,
  previous_interval_days integer not null,
  previous_is_active boolean not null,
  next_search_query text not null,
  next_scope_notes text not null,
  next_interval_days integer not null,
  next_is_active boolean not null
);

create index if not exists marketplace_profile_revisions_profile_changed_idx
  on public.marketplace_profile_revisions(profile_id, changed_at desc);

alter table public.marketplace_profile_revisions enable row level security;

create or replace function public.update_marketplace_search_profile(
  p_profile_id uuid,
  p_search_query text,
  p_scope_notes text,
  p_collection_interval_days integer,
  p_is_active boolean,
  p_changed_by text,
  p_change_note text
)
returns public.marketplace_search_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_profile public.marketplace_search_profiles;
  updated_profile public.marketplace_search_profiles;
begin
  if length(trim(coalesce(p_search_query, ''))) = 0 then raise exception 'Search query is required'; end if;
  if length(trim(coalesce(p_scope_notes, ''))) < 20 then raise exception 'Scope note must be at least 20 characters'; end if;
  if p_collection_interval_days < 1 or p_collection_interval_days > 365 then raise exception 'Collection interval must be between 1 and 365 days'; end if;
  if length(trim(coalesce(p_changed_by, ''))) = 0 then raise exception 'Editor is required'; end if;
  if length(trim(coalesce(p_change_note, ''))) < 8 then raise exception 'Change note must be at least 8 characters'; end if;

  select * into current_profile from public.marketplace_search_profiles where id = p_profile_id for update;
  if not found then raise exception 'Search profile does not exist'; end if;

  update public.marketplace_search_profiles
  set search_query = trim(p_search_query),
      scope_notes = trim(p_scope_notes),
      collection_interval_days = p_collection_interval_days,
      is_active = p_is_active,
      updated_at = now()
  where id = p_profile_id
  returning * into updated_profile;

  insert into public.marketplace_profile_revisions (
    profile_id, changed_by, change_note,
    previous_search_query, previous_scope_notes, previous_interval_days, previous_is_active,
    next_search_query, next_scope_notes, next_interval_days, next_is_active
  ) values (
    current_profile.id, trim(p_changed_by), trim(p_change_note),
    current_profile.search_query, current_profile.scope_notes, current_profile.collection_interval_days, current_profile.is_active,
    updated_profile.search_query, updated_profile.scope_notes, updated_profile.collection_interval_days, updated_profile.is_active
  );

  return updated_profile;
end;
$$;

revoke all on function public.update_marketplace_search_profile(uuid, text, text, integer, boolean, text, text) from public;
