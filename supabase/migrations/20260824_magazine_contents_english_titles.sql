-- The contents of a Japanese magazine are recorded in Japanese, which is
-- correct for the record and unreadable for most of RAR's audience.
--
-- Romanised Japanese, not translation. Collectors and sellers write "Hokuto no
-- Ken", not "Fist of the North Star", and a search on eBay finds the former.
-- Where no romanisation exists the English title is used; where neither
-- exists this stays null and the page shows the Japanese title alone, because
-- a guessed title is worse than an honest one -- MangaDex offers "Man's Hill"
-- for 男坂, a literal translation nobody uses, against the romanisation
-- "Otokozaka" that everybody does.
alter table public.magazine_issue_contents
  add column if not exists work_title_en text,
  add column if not exists work_title_source text;

comment on column public.magazine_issue_contents.work_title_en is
  'Romanised Japanese title where one exists, else an English title. Null when neither could be resolved confidently.';
comment on column public.magazine_issue_contents.work_title_source is
  'Where work_title_en came from, so an unrecognised or wrong name can be traced.';
