-- Priority-1 fix: formalise the relationship between a general ISBN-level
-- edition record and a separately proven specific printing of it. This is
-- additive only — no existing query or page reads this column yet, so it
-- changes nothing visible on its own.
alter table public.manga_editions
  add column if not exists printing_of_edition_id uuid references public.manga_editions(id);

create index if not exists manga_editions_printing_of_idx
  on public.manga_editions(printing_of_edition_id);

alter table public.manga_editions
  add constraint manga_editions_printing_of_not_self check (printing_of_edition_id is distinct from id);

-- Link the three ISBN-duplicate pairs found in the 2026-08-04 catalogue
-- audit. In each pair the printing-specific record already carries stronger
-- printing evidence (copyright-page proof, printing_number, or a named
-- variant) than its general sibling. No price_observations, edition_sources
-- or marketplace_search_profiles rows are touched — they already point at
-- the correct precise record in every pair.

-- One Piece Vol. 1 Japanese (ISBN 9784088725093):
-- "One Piece 1" / 1997 first printing (verified) is a printing of
-- "ONE PIECE 1" / Jump Comics standard edition record.
update public.manga_editions
set printing_of_edition_id = '9e28c5a9-fe72-47a6-a6fb-b99304885ee3'::uuid
where id = 'f85e616c-7aa8-4806-8c18-2af0d5aa78be'::uuid
  and printing_of_edition_id is null;

-- Hunter x Hunter Vol. 1 Japanese (ISBN 9784088725710):
-- "Hunter x Hunter" / First printing is a printing of
-- "Hunter x Hunter" / Standard edition record.
update public.manga_editions
set printing_of_edition_id = '003d336e-38be-411a-8e86-bc2427204b40'::uuid
where id = '52e1799d-cb86-4e3e-b67c-3b5c2092404d'::uuid
  and printing_of_edition_id is null;

-- One Piece Vol. 1 English (ISBN 9781569319017):
-- "Gold Foil 9th printing (candidate)" (unverified) is a printing of the
-- verified standard "One Piece, Vol. 1" VIZ Media paperback edition.
update public.manga_editions
set printing_of_edition_id = '816516fa-d79d-4e02-ba24-d32e9d75dd31'::uuid
where id = 'a97475b2-9eb3-49b4-9483-083fc77adceb'::uuid
  and printing_of_edition_id is null;
