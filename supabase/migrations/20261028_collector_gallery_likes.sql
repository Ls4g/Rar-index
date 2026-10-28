-- A member may like a public collector gallery once. Individual member IDs
-- remain private; visitors receive only aggregate counts through the RPC.
begin;

create table public.collector_gallery_likes (
  profile_user_id uuid not null references public.collector_profiles(user_id) on delete cascade,
  member_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_user_id, member_user_id)
);

alter table public.collector_gallery_likes enable row level security;
create policy "Members can see their own gallery likes"
  on public.collector_gallery_likes for select to authenticated
  using (member_user_id = auth.uid());
create policy "Members can like public galleries"
  on public.collector_gallery_likes for insert to authenticated
  with check (member_user_id = auth.uid() and member_user_id <> profile_user_id and exists (
    select 1 from public.collector_profiles p
    where p.user_id = profile_user_id and p.shelf_is_public
  ));
create policy "Members can remove their own gallery likes"
  on public.collector_gallery_likes for delete to authenticated
  using (member_user_id = auth.uid());

grant select, delete on public.collector_gallery_likes to authenticated;
grant insert (profile_user_id, member_user_id) on public.collector_gallery_likes to authenticated;

create function public.collector_gallery_social_counts(profile_ids uuid[])
returns table(profile_user_id uuid, like_count bigint, comment_count bigint)
language sql stable security definer set search_path = public
as $$
  select p.user_id,
    (select count(*) from public.collector_gallery_likes l where l.profile_user_id = p.user_id),
    (select count(*) from public.collector_gallery_comments c
      where c.profile_user_id = p.user_id and not c.is_hidden and p.comments_enabled)
  from public.collector_profiles p
  where p.user_id = any(profile_ids) and p.shelf_is_public
    and cardinality(profile_ids) <= 24;
$$;
revoke all on function public.collector_gallery_social_counts(uuid[]) from public;
grant execute on function public.collector_gallery_social_counts(uuid[]) to anon, authenticated;

commit;
