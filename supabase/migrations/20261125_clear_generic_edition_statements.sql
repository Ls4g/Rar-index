-- Clear edition statements that only name the standard edition.
--
-- 24 English records carry an edition statement that just says they are the
-- publisher's normal English paperback ("VIZ Media English paperback
-- edition", "Kodansha Comics English paperback edition", ...), while every
-- other volume of the same standard run has none. Grouping by edition then
-- split one run in two: One Piece showed as vols 1-10 and 11-19, Naruto and
-- Dragon Ball likewise, and Berserk vol 1 and Akira vol 1 looked missing.
--
-- Only statements that exactly match "<publisher> English [trade] paperback
-- edition" are cleared. Real edition statements (Omnibus, Perfect Edition,
-- deluxe, hardcover...) are untouched. Old values are kept in
-- catalogue_corrections_20261125b. To reverse:
--   update manga_editions e set edition_statement = c.old_edition_statement
--   from catalogue_corrections_20261125b c where c.edition_id = e.id;

begin;

create table if not exists public.catalogue_corrections_20261125b (
  edition_id uuid primary key,
  old_edition_statement text not null,
  corrected_at timestamptz not null default now()
);
alter table public.catalogue_corrections_20261125b enable row level security;

insert into public.catalogue_corrections_20261125b (edition_id, old_edition_statement)
select id, edition_statement
from public.manga_editions
where language = 'English'
  and edition_statement ~* '^(VIZ Media|Dark Horse Manga|Dark Horse Comics|Kodansha Comics) English (trade )?paperback edition$'
on conflict (edition_id) do nothing;

update public.manga_editions e
set edition_statement = null
from public.catalogue_corrections_20261125b c
where c.edition_id = e.id and e.edition_statement = c.old_edition_statement;

commit;
