-- Catalogue corrections from the 10 November 2026 audit: wrong language tags
-- and one publisher written many ways.
--
-- Why: the public catalogue listed three Spanish series and one Japanese
-- volume as English, showed an author as a publisher, and wrote VIZ Media six
-- ways (Viz, Viz Media, VIZ Media, VIZ Media LLC, "VIZ Media, LLC", plus the
-- SHONEN JUMP imprints as if they were publishers). Japanese publishers
-- appeared in kanji on imported rows and in romaji on reviewed ones. Beyond
-- looking careless, this breaks matching: lib/liveListings.ts recognises a
-- publisher by its romaji name, so a 集英社 or SHONEN JUMP row can never agree
-- with a listing that says "Shueisha" or "VIZ".
--
-- What this does NOT touch: titles, ISBNs, authors, volume numbers, sales,
-- Scout leads, staff decisions or search profiles. Only publisher, imprint and
-- language change, and only on rows whose ISBN prefix or id confirms the fix
-- (checked read-only before writing: no row in the VIZ, Dark Horse or Gollancz
-- groups has an ISBN outside that publisher's own ranges, and none of the nine
-- individually corrected editions has a sale or a portfolio holding).
--
-- Reversible: the first statement snapshots publisher, imprint and language
-- for every edition into catalogue_corrections_20261110. To undo:
--   update public.manga_editions e
--   set publisher = b.old_publisher, imprint = b.old_imprint, language = b.old_language
--   from public.catalogue_corrections_20261110 b where b.edition_id = e.id;
--
-- Left for a person to decide (deliberately not done here):
--   * The eight re-tagged editions each keep a search profile whose query still
--     says "English". The ISBN in the query keeps it pointing at the right
--     book, but the Spanish ones will find little until the query is edited.
--   * Assassination Classroom 2 and 3 list the Spanish translator as author.
--   * Whether Spanish editions belong in the catalogue at all.

begin;

create table if not exists public.catalogue_corrections_20261110 (
  edition_id uuid primary key references public.manga_editions(id) on delete cascade,
  old_publisher text,
  old_imprint text,
  old_language text,
  recorded_at timestamptz not null default now()
);
alter table public.catalogue_corrections_20261110 enable row level security;
revoke all on public.catalogue_corrections_20261110 from public, anon, authenticated;

-- Snapshot first. "do nothing" on a re-run, so the original values survive.
insert into public.catalogue_corrections_20261110 (edition_id, old_publisher, old_imprint, old_language)
select id, publisher, imprint, language from public.manga_editions
on conflict (edition_id) do nothing;

-- 1. Language. Seven Spanish editions (ISBN group 978-84) tagged English.
update public.manga_editions
set language = 'Spanish'
where language = 'English'
  and isbn_13 like '97884%'
  and id in (
    'f2847e65-a25c-4e8f-96af-7702d866ae7a', -- Assassination Classroom 1 (Panini)
    '579869e0-af06-40e5-bbff-d9e744aadced', -- Assassination Classroom 2 (Panini)
    'c8527504-7e5f-484a-96f7-a35e7a50551a', -- Assassination Classroom 3 (Panini)
    'a65db1b6-a663-4a82-8e17-6336091ff1e3', -- Deadman Wonderland 1 (Ivrea)
    'eb759534-4839-4ffe-8f12-db8dae7ec79c', -- Fire Force 1 (Norma)
    'e19875ac-c81d-48c5-aa5f-9da74517dab8', -- Fire Force 2 (Norma)
    '8c9c0e5f-a7bb-4e76-8c55-f32b098b9d8c'  -- Fire Force 3 (Norma)
  );

-- "Initial D Vol. 2 (Inisharu D) (in Japanese)": a Kodansha Japan ISBN.
update public.manga_editions
set language = 'Japanese'
where id = 'f676f592-33cb-4cae-9f3a-85b5c1f51d7f'
  and language = 'English'
  and isbn_13 = '9784063235838';

-- 2. Gantz Volume 1 listed its author, "Oku, Hiroya", as publisher. Dark
-- Horse's own page for the 2008 paperback:
-- https://www.darkhorse.com/Books/14-734/Gantz-Volume-1-TPB
update public.manga_editions
set publisher = 'Dark Horse Comics', imprint = coalesce(imprint, 'Dark Horse Manga')
where id = '41092af4-901b-4ebe-ade6-b57f9129d83c'
  and publisher = 'Oku, Hiroya'
  and isbn_13 = '9781593079499';

-- 3. VIZ Media. SHONEN JUMP and SHONEN JUMP ADVANCED are VIZ imprints and are
-- already recorded that way on 21 reviewed rows; the name moves to imprint.
update public.manga_editions
set imprint = coalesce(imprint, case when publisher in ('SHONEN JUMP', 'SHONEN JUMP ADVANCED') then publisher end),
    publisher = 'VIZ Media'
where publisher in ('Viz', 'Viz Media', 'VIZ Media LLC', 'VIZ Media, LLC', 'SHONEN JUMP', 'SHONEN JUMP ADVANCED')
  and isbn_13 ~ '^(978156931|978159116|97814215|97819747|9780929279)';

-- 4. Dark Horse. "Dark Horse Manga" is the imprint; it is kept as one.
update public.manga_editions
set imprint = coalesce(imprint, case when publisher = 'Dark Horse Manga' then 'Dark Horse Manga' end),
    publisher = 'Dark Horse Comics'
where publisher in ('Dark Horse', 'Dark Horse Manga')
  and isbn_13 ~ '^(978156971|978159307)';

-- 5. Kodansha's English-language books are published as Kodansha Comics.
update public.manga_editions
set publisher = 'Kodansha Comics'
where language = 'English'
  and publisher in ('kodansha', 'Kodansha', 'Kodansha America, Incorporated')
  and isbn_13 ~ '^(9781612|9781632|9781935|9798888)';

-- 6. Legal suffixes, capitals and a truncated name.
update public.manga_editions set publisher = 'Yen Press' where publisher = 'Yen Press LLC';
update public.manga_editions set publisher = 'Panini Manga' where publisher in ('PANINIMANGA', 'PANINI MANGA');
update public.manga_editions set publisher = 'Norma Editorial' where publisher = 'NORMA EDITORIAL, S.A.';
update public.manga_editions set publisher = 'Vertical' where publisher = 'Vertical, Incorporated';
update public.manga_editions set publisher = 'Gollancz'
where publisher in ('GOLLANCZ (ORIO)', 'Orion Publishing Group, Limited') and isbn_13 like '9780575%';

-- 7. Japanese publishers in romaji, as the reviewed Shueisha and Kodansha rows
-- already are. Written as Unicode escapes so the file survives any editor.
update public.manga_editions set publisher = 'Shueisha' where publisher = U&'\96C6\82F1\793E'; -- 集英社
update public.manga_editions set publisher = 'Kodansha' where publisher = U&'\8B1B\8AC7\793E'; -- 講談社
update public.manga_editions set publisher = 'Shogakukan' where publisher = U&'\5C0F\5B66\9928'; -- 小学館
update public.manga_editions set publisher = 'Akita Shoten' where publisher = U&'\79CB\7530\66F8\5E97'; -- 秋田書店
update public.manga_editions set publisher = 'Nihon Bungeisha' where publisher = U&'\65E5\672C\6587\82B8\793E'; -- 日本文芸社
update public.manga_editions set publisher = 'Square Enix' where publisher = U&'\30B9\30AF\30A6\30A7\30A2\30FB\30A8\30CB\30C3\30AF\30B9'; -- スクウェア・エニックス

-- Refuse the whole change if any old spelling survived or a row went missing.
do $$
declare
  leftover integer;
  spanish integer;
begin
  select count(*) into leftover from public.manga_editions
  where publisher in ('Viz', 'Viz Media', 'VIZ Media LLC', 'VIZ Media, LLC', 'SHONEN JUMP', 'SHONEN JUMP ADVANCED',
    'Dark Horse', 'Dark Horse Manga', 'kodansha', 'Kodansha America, Incorporated', 'Yen Press LLC', 'PANINIMANGA',
    'PANINI MANGA', 'NORMA EDITORIAL, S.A.', 'Vertical, Incorporated', 'GOLLANCZ (ORIO)',
    'Orion Publishing Group, Limited', 'Oku, Hiroya')
    or octet_length(publisher) <> char_length(publisher);
  if leftover > 0 then
    raise exception 'Publisher normalisation incomplete: % rows still carry an old or non-romaji spelling', leftover;
  end if;

  select count(*) into spanish from public.manga_editions where language = 'Spanish';
  if spanish <> 7 then
    raise exception 'Expected 7 Spanish editions, found %', spanish;
  end if;

  if not exists (select 1 from public.manga_editions
    where id = 'f676f592-33cb-4cae-9f3a-85b5c1f51d7f' and language = 'Japanese') then
    raise exception 'Initial D Vol. 2 was not re-tagged Japanese';
  end if;

  if (select count(*) from public.manga_editions) <> (select count(*) from public.catalogue_corrections_20261110) then
    raise exception 'Snapshot and catalogue row counts differ';
  end if;
end $$;

commit;

select publisher, language, count(*) as editions
from public.manga_editions
group by 1, 2
order by 1, 2;
