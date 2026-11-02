-- First-phase, manually granted Premium preview. This is not a billing table.
-- Only the database owner/service role can grant access; members can read
-- access so the public badge is never based on a client-supplied claim.
begin;

create table if not exists public.collector_premium_access (
  user_id uuid primary key references public.collector_profiles(user_id) on delete cascade,
  access_kind text not null default 'founder_preview'
    check (access_kind = 'founder_preview'),
  granted_at timestamptz not null default now()
);

alter table public.collector_premium_access enable row level security;
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'collector_premium_access'
      and policyname = 'Anyone can read collector premium status'
  ) then
    create policy "Anyone can read collector premium status"
      on public.collector_premium_access for select using (true);
  end if;
end $$;
grant select on public.collector_premium_access to anon, authenticated;

alter table public.collector_gallery_layouts
  add column if not exists gallery_theme text not null default 'studio',
  add column if not exists show_premium_badge boolean not null default false;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.collector_gallery_layouts'::regclass
      and conname = 'collector_gallery_theme_choice'
  ) then
    alter table public.collector_gallery_layouts
      add constraint collector_gallery_theme_choice
      check (gallery_theme in ('studio', 'saffron', 'indigo'));
  end if;
end $$;

create or replace function public.validate_collector_premium_gallery()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.gallery_theme <> 'studio' or new.show_premium_badge)
    and not exists (
      select 1 from public.collector_premium_access access
      where access.user_id = new.user_id
    ) then
    raise exception 'Premium gallery options require preview access.';
  end if;
  return new;
end;
$$;

drop trigger if exists collector_premium_gallery_validate on public.collector_gallery_layouts;
create trigger collector_premium_gallery_validate
  before insert or update on public.collector_gallery_layouts
  for each row execute function public.validate_collector_premium_gallery();

-- Let the founder test the first phase on their existing @shamar gallery.
-- This grants no payment, seller, staff or catalogue permissions.
insert into public.collector_premium_access (user_id)
select user_id from public.collector_profiles where username_key = 'shamar'
on conflict (user_id) do nothing;

commit;
