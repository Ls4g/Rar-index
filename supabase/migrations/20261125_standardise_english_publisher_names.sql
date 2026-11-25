-- Standardise English publisher names so one edition is one publisher.
--
-- The same English edition was recorded under several spellings: VIZ as
-- "VIZ Media", "VIZ Media LLC", "Viz Media", "Viz", "SHONEN JUMP" and
-- "SHONEN JUMP ADVANCED" (VIZ imprints); Dark Horse as "Dark Horse" and
-- "Dark Horse Comics". Anything that groups by publisher (series runs on the
-- collector gallery Wall, catalogue completeness counts) split one run into
-- several, e.g. Claymore showed as runs of 10 and 4.
--
-- Only English records change, only the publisher column, only these exact
-- old spellings. Kodansha (Japanese) and Kodansha Comics (English) are
-- different companies and stay apart; Gollancz, Tandem Library and
-- Turtleback are distinct editions and stay as they are. The old values
-- (including which VIZ imprint was named) are kept in
-- catalogue_corrections_20261125. To reverse:
--   update manga_editions e set publisher = c.old_publisher
--   from catalogue_corrections_20261125 c where c.edition_id = e.id;

begin;

create table if not exists public.catalogue_corrections_20261125 (
  edition_id uuid primary key,
  old_publisher text not null,
  new_publisher text not null,
  corrected_at timestamptz not null default now()
);
alter table public.catalogue_corrections_20261125 enable row level security;

insert into public.catalogue_corrections_20261125 (edition_id, old_publisher, new_publisher)
select id, publisher,
  case when publisher in ('VIZ Media LLC', 'Viz Media', 'Viz', 'SHONEN JUMP', 'SHONEN JUMP ADVANCED') then 'VIZ Media'
       when publisher = 'Dark Horse' then 'Dark Horse Comics' end
from public.manga_editions
where language = 'English'
  and publisher in ('VIZ Media LLC', 'Viz Media', 'Viz', 'SHONEN JUMP', 'SHONEN JUMP ADVANCED', 'Dark Horse')
on conflict (edition_id) do nothing;

update public.manga_editions e
set publisher = c.new_publisher
from public.catalogue_corrections_20261125 c
where c.edition_id = e.id and e.publisher = c.old_publisher;

commit;
