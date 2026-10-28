-- Optional discovery and gallery conversation. Existing public shelves do not
-- appear in the directory or accept comments until their owner opts in.
begin;
alter table public.collector_profiles
  add column if not exists directory_visible boolean not null default false,
  add column if not exists comments_enabled boolean not null default false;

create table if not exists public.collector_gallery_comments (
  id uuid primary key default gen_random_uuid(),
  profile_user_id uuid not null references public.collector_profiles(user_id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists collector_gallery_comments_profile_created_idx
  on public.collector_gallery_comments(profile_user_id, created_at desc);

create or replace function public.limit_collector_gallery_comments()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from public.collector_gallery_comments
    where author_user_id = new.author_user_id
      and created_at > now() - interval '20 seconds'
  ) then
    raise exception 'Please wait a little before commenting again.';
  end if;
  return new;
end;
$$;
create trigger collector_gallery_comments_rate_limit
  before insert on public.collector_gallery_comments
  for each row execute function public.limit_collector_gallery_comments();

alter table public.collector_gallery_comments enable row level security;
create policy "Read visible comments on open public galleries"
  on public.collector_gallery_comments for select
  using (not is_hidden and exists (
    select 1 from public.collector_profiles p
    where p.user_id = profile_user_id and p.shelf_is_public and p.comments_enabled
  ));
create policy "Members can comment on open public galleries"
  on public.collector_gallery_comments for insert to authenticated
  with check (author_user_id = auth.uid() and not is_hidden and exists (
    select 1 from public.collector_profiles p
    where p.user_id = profile_user_id and p.shelf_is_public and p.comments_enabled
  ));
create policy "Authors and gallery owners can remove comments"
  on public.collector_gallery_comments for delete to authenticated
  using (author_user_id = auth.uid() or profile_user_id = auth.uid());
grant select on public.collector_gallery_comments to anon;
grant select, insert, delete on public.collector_gallery_comments to authenticated;

create table if not exists public.collector_gallery_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.collector_gallery_comments(id) on delete cascade,
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(btrim(reason)) between 1 and 240),
  status text not null default 'open' check (status in ('open', 'dismissed', 'hidden')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (comment_id, reporter_user_id)
);
alter table public.collector_gallery_comment_reports enable row level security;
create policy "Members can report visible gallery comments"
  on public.collector_gallery_comment_reports for insert to authenticated
  with check (reporter_user_id = auth.uid() and exists (
    select 1 from public.collector_gallery_comments c
    where c.id = comment_id and not c.is_hidden
  ));
grant insert on public.collector_gallery_comment_reports to authenticated;
commit;
