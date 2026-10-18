-- A collector chooses which owned, cover-verified editions appear on their
-- public gallery wall and in what order. The rest of their shelf is unchanged.
-- The array is one atomic layout, so a drag/swap cannot leave half a wall saved.
create table if not exists public.collector_gallery_layouts (
  user_id uuid primary key references public.collector_profiles(user_id) on delete cascade,
  edition_ids uuid[] not null,
  updated_at timestamptz not null default now(),
  constraint collector_gallery_layout_size check (cardinality(edition_ids) between 0 and 16)
);

create or replace function public.validate_collector_gallery_layout()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if cardinality(new.edition_ids) <> (
    select count(distinct chosen.edition_id) from unnest(new.edition_ids) as chosen(edition_id)
  ) then
    raise exception 'Gallery editions must be unique.';
  end if;

  if exists (
    select 1 from unnest(new.edition_ids) as chosen(edition_id)
    where not exists (
      select 1 from public.portfolio_holdings holding
      join public.manga_editions edition on edition.id = holding.edition_id
      where holding.user_id = new.user_id
        and holding.edition_id = chosen.edition_id
        and edition.cover_verification_status = 'verified'
        and edition.cover_image_url is not null
    )
  ) then
    raise exception 'Gallery editions must be owned and have verified covers.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists collector_gallery_layout_validate on public.collector_gallery_layouts;
create trigger collector_gallery_layout_validate
  before insert or update on public.collector_gallery_layouts
  for each row execute function public.validate_collector_gallery_layout();

alter table public.collector_gallery_layouts enable row level security;

create policy "Owners can read their gallery layout"
  on public.collector_gallery_layouts for select
  using (auth.uid() = user_id);

create policy "Visitors can read published gallery layouts"
  on public.collector_gallery_layouts for select
  using (exists (
    select 1 from public.collector_profiles profile
    where profile.user_id = collector_gallery_layouts.user_id
      and profile.shelf_is_public
  ));

create policy "Owners can create their gallery layout"
  on public.collector_gallery_layouts for insert
  with check (auth.uid() = user_id);

create policy "Owners can update their gallery layout"
  on public.collector_gallery_layouts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select on public.collector_gallery_layouts to anon;
grant select, insert, update on public.collector_gallery_layouts to authenticated;
