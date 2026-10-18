-- Collector-authored text belongs to the chosen wall, not to the catalogue or
-- private holding notes. It is readable only under the layout's existing RLS.
begin;

alter table public.collector_gallery_layouts
  add column if not exists title text not null default '',
  add column if not exists caption text not null default '',
  add column if not exists edition_comments jsonb not null default '{}'::jsonb;

alter table public.collector_gallery_layouts
  add constraint collector_gallery_title_length check (char_length(title) <= 80),
  add constraint collector_gallery_caption_length check (char_length(caption) <= 240),
  add constraint collector_gallery_comments_object check (jsonb_typeof(edition_comments) = 'object');

create function public.validate_collector_gallery_content()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if exists (
    select 1 from jsonb_each(new.edition_comments) as entry(edition_id, body)
    where entry.edition_id <> all(new.edition_ids::text[])
      or jsonb_typeof(entry.body) <> 'string'
      or char_length(trim(both from (entry.body #>> '{}'))) > 280
  ) then
    raise exception 'Gallery comments must be short text for editions on this wall.';
  end if;
  return new;
end;
$$;

create trigger collector_gallery_content_validate
  before insert or update on public.collector_gallery_layouts
  for each row execute function public.validate_collector_gallery_content();

commit;
