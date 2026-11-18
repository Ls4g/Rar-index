-- Label the Kodama Tales "Baki the Grappler" records as the Perfect Edition.
--
-- Kodama Tales' English release IS the Perfect Edition: ISBN 9781966523000
-- (Vol. 1) and 9781966523055 (Vol. 3) are listed by retailers as "Baki the
-- Grappler (Perfect Edition) Vol. 1 / Vol. 3", and the 978-1-966523 run
-- continues to Vol. 9 under the same name. The six records did not say so,
-- so since 16 Nov Scout has marked "Perfect Edition" listings for them as a
-- different edition. Setting the edition statement fixes that.
--
-- Only edition_statement changes, only where it is empty, only for these six
-- ISBNs. The Japanese Akita Shoten record is untouched. Before-values are
-- kept in catalogue_corrections_20261118 to reverse:
--   update manga_editions e set edition_statement = c.old_edition_statement
--   from catalogue_corrections_20261118 c where c.edition_id = e.id;

begin;

create table if not exists public.catalogue_corrections_20261118 (
  edition_id uuid primary key,
  isbn_13 text,
  old_edition_statement text,
  corrected_at timestamptz not null default now()
);
alter table public.catalogue_corrections_20261118 enable row level security;

insert into public.catalogue_corrections_20261118 (edition_id, isbn_13, old_edition_statement)
select id, isbn_13, edition_statement
from public.manga_editions
where isbn_13 in ('9781966523000','9781966523031','9781966523055','9781966523062','9781966523079','9781966523086')
  and publisher = 'Kodama Tales Inc.'
  and coalesce(edition_statement, '') = ''
on conflict (edition_id) do nothing;

update public.manga_editions
set edition_statement = 'Perfect Edition'
where id in (select edition_id from public.catalogue_corrections_20261118);

commit;
