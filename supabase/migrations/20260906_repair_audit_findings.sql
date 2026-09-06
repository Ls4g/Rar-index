-- Repair findings from the 6 September production audit.
-- Exact identifiers keep the cleanup narrow. Catalogue identity corrections
-- are backed by the publishers' own product pages and do not reassign sales.

begin;

-- A verification script accidentally left its fixture in production. Its
-- review decision is deleted by the observation FK's ON DELETE CASCADE.
delete from public.price_observations
where id = 'dc433802-76a2-4a15-99da-00e7e60aa819'::uuid
  and source_listing_url = 'https://example.com/test-listing'
  and listing_title = 'Test verification sale'
  and reviewed_by = 'verification-script';

-- The ISBN already belonged to the English VIZ volume; the imported publisher
-- text was user-generated Open Library metadata rather than the publisher.
update public.manga_editions
set title = 'Yu-Gi-Oh!, Vol. 1',
    series = 'Yu-Gi-Oh!',
    volume_number = '1',
    author = 'Kazuki Takahashi',
    publisher = 'VIZ Media',
    imprint = 'SHONEN JUMP',
    language = 'English',
    country = 'United States',
    isbn_10 = '1569319030',
    isbn_13 = '9781569319031',
    release_date = '2003-05-07',
    format = 'Paperback',
    cover_image_url = 'https://dw9to29mmj727.cloudfront.net/products/1569319030.jpg',
    cover_source_url = 'https://www.viz.com/manga-books/manga/yu-gi-oh-volume-1/product/154/paperback',
    cover_source_name = 'VIZ Media',
    cover_verification_status = 'verified',
    updated_at = now()
where id = '7e172fe6-c08e-4f45-9aca-71bf6ce7141d'::uuid
  and not exists (
    select 1 from public.price_observations sale
    where sale.edition_id = '7e172fe6-c08e-4f45-9aca-71bf6ce7141d'::uuid
  );

-- The previous row was a Portuguese Panini ISBN labelled as English. Replace
-- that empty record with the intended official VIZ English volume-one record.
update public.manga_editions
set title = 'SPY x FAMILY, Vol. 1',
    series = 'SPY x FAMILY',
    volume_number = '1',
    author = 'Tatsuya Endo',
    publisher = 'VIZ Media',
    imprint = 'SHONEN JUMP',
    language = 'English',
    country = 'United States',
    isbn_10 = '1974715469',
    isbn_13 = '9781974715466',
    release_date = '2020-06-02',
    format = 'Paperback',
    cover_image_url = 'https://dw9to29mmj727.cloudfront.net/products/1974715469.jpg',
    cover_source_url = 'https://www.viz.com/manga-books/manga/spy-x-family-volume-1-0/product/6302/paperback',
    cover_source_name = 'VIZ Media',
    cover_verification_status = 'verified',
    updated_at = now()
where id = '5506cd19-1fe3-4251-b1c5-9c7de82f299c'::uuid
  and not exists (
    select 1 from public.price_observations sale
    where sale.edition_id = '5506cd19-1fe3-4251-b1c5-9c7de82f299c'::uuid
  );

insert into public.edition_sources (
  edition_id, source_id, source_record_url, external_id, fields_verified,
  source_data, verification_notes, is_primary
)
select corrected.edition_id, source.id, corrected.url, corrected.external_id,
  array['title','series','volume_number','author','publisher','imprint','language','country','isbn_10','isbn_13','release_date','format','cover_image_url'],
  jsonb_build_object('rar_catalogue_correction', true, 'reviewed_at', '2026-09-06'),
  'Official VIZ product record confirms this publication identity. This is catalogue evidence, not printing evidence.',
  true
from public.sources source
cross join (values
  ('7e172fe6-c08e-4f45-9aca-71bf6ce7141d'::uuid, 'https://www.viz.com/manga-books/manga/yu-gi-oh-volume-1/product/154/paperback', 'viz-product-154'),
  ('5506cd19-1fe3-4251-b1c5-9c7de82f299c'::uuid, 'https://www.viz.com/manga-books/manga/spy-x-family-volume-1-0/product/6302/paperback', 'viz-product-6302')
) as corrected(edition_id, url, external_id)
where source.name = 'VIZ Media'
  and not exists (
    select 1 from public.edition_sources evidence
    where evidence.edition_id = corrected.edition_id
      and evidence.source_record_url = corrected.url
  );

update public.edition_sources
set is_primary = false
where edition_id in (
  '7e172fe6-c08e-4f45-9aca-71bf6ce7141d'::uuid,
  '5506cd19-1fe3-4251-b1c5-9c7de82f299c'::uuid
)
and source_record_url like 'https://openlibrary.org/%';

update public.marketplace_search_profiles
set search_query = 'Yu-Gi-Oh manga Vol. 1 English 9781569319031',
    scope_notes = 'RAR-generated eBay profile for Yu-Gi-Oh!, Vol. 1, English, VIZ Media, ISBN 9781569319031. Keep exact-edition matches only; exclude other volumes, languages, lots, sets and graded copies.',
    last_checked_at = null,
    last_checked_result_count = null,
    updated_at = now()
where edition_id = '7e172fe6-c08e-4f45-9aca-71bf6ce7141d'::uuid;

update public.marketplace_search_profiles
set search_query = 'SPY x FAMILY manga Vol. 1 English 9781974715466',
    scope_notes = 'RAR-generated eBay profile for SPY x FAMILY, Vol. 1, English, VIZ Media, ISBN 9781974715466. Keep exact-edition matches only; exclude other volumes, languages, lots, sets and graded copies.',
    last_checked_at = null,
    last_checked_result_count = null,
    updated_at = now()
where edition_id = '5506cd19-1fe3-4251-b1c5-9c7de82f299c'::uuid;

-- Correct exact dates Open Library supplied in words but the old importer
-- reduced to January 1. This list intentionally excludes already-correct
-- genuine January dates and records whose source did not expose a date.
update public.manga_editions as edition
set release_date = corrected.release_date::date,
    updated_at = now()
from (values
  ('391db768-efa1-42de-a36b-3f3f6f4748ae'::uuid, '1995-05-06'),
  ('85c833cd-82c4-4313-b509-f51f7b8b6c7e'::uuid, '1999-02-05'),
  ('bdf4336f-a121-4409-906d-332cb178a835'::uuid, '2002-03-15'),
  ('1d99594a-3017-4fc6-9165-d7f2f59ffef7'::uuid, '2003-10-07'),
  ('326e3e7c-74f4-4e73-95e2-8b04158e68e8'::uuid, '2005-12-06'),
  ('16258dc3-6d6e-4dda-b5b8-a41ce4685005'::uuid, '2005-11-01'),
  ('f766a41c-683b-43b5-9c0f-c0ab9790ff43'::uuid, '2006-10-03'),
  ('fee74a49-d45c-43bd-8fe7-b167957da1f5'::uuid, '2006-02-07'),
  ('dc7892ca-8583-43d3-b34b-19451fab8dd9'::uuid, '2006-07-05'),
  ('fe9ae72c-7de3-469d-ae1c-3b0d4fa95dc1'::uuid, '2007-08-07'),
  ('a3636dd8-b74a-488c-9521-cefe656aa8d9'::uuid, '2007-11-06'),
  ('51dd1124-4e75-456d-98bc-f75ff6158f41'::uuid, '2008-03-04'),
  ('2f51cd39-f0c7-44ee-aa19-a945783e75d7'::uuid, '2008-01-08'),
  ('a4a68d1a-58b7-4b5f-b94d-cae487ee79fd'::uuid, '2008-06-03'),
  ('0809d334-4e3d-43c6-a2fa-a8a3b6b5ca49'::uuid, '2012-12-04'),
  ('671fb216-f53a-4a8c-a06c-0db71b6651f3'::uuid, '2015-08-04'),
  ('9b33cc09-9379-4c20-81af-e92a9a066c81'::uuid, '2025-05-06')
) as corrected(id, release_date)
where edition.id = corrected.id;

-- These sources supplied only a year. Null is honest until an exact publisher
-- date is researched; January 1 was never evidence.
update public.manga_editions
set release_date = null,
    updated_at = now()
where id in (
  '44320e81-d290-4e2f-a555-85b8146bef5d'::uuid,
  '20c1cf30-612e-4a05-a810-2766005be790'::uuid,
  'b5e99b63-9c88-405a-8844-dbce1e1d2ca4'::uuid,
  '25b0f305-58e1-4930-8bb8-fb52562bb2e1'::uuid,
  '1f59b8d2-a599-4f07-8ead-3aeb621df4f1'::uuid,
  '9796c783-f49e-4ff5-afba-39a6f6d04758'::uuid,
  '610db903-66a9-49b5-b2c8-6dc38470b090'::uuid,
  '88591216-d646-4516-a86f-0a9dc2c70378'::uuid,
  '7fadc305-0b0a-42cd-9369-648512dfc903'::uuid
);

commit;
