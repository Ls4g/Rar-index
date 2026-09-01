-- Repair two catalogue rows proven wrong during the September audit.
-- Both corrections are backed by exact official publisher records and neither
-- edition has price observations, so no market evidence is being reassigned.

update public.manga_editions
set title = 'Chainsaw Man 1',
    series = 'Chainsaw Man',
    volume_number = '1',
    author = 'Tatsuki Fujimoto',
    publisher = 'Shueisha',
    language = 'Japanese',
    isbn_13 = '9784088817804',
    release_date = '2019-03-04',
    updated_at = now()
where id = 'e48009c2-e36c-4b5c-936a-5da4728da55f'::uuid
  and not exists (
    select 1 from public.price_observations sale
    where sale.edition_id = 'e48009c2-e36c-4b5c-936a-5da4728da55f'::uuid
  );

update public.manga_editions
set title = 'Black Clover, Vol. 2',
    series = 'Black Clover',
    volume_number = '2',
    author = 'Yuki Tabata',
    publisher = 'VIZ Media',
    language = 'English',
    isbn_13 = '9781421587196',
    release_date = '2016-08-02',
    format = 'Paperback',
    updated_at = now()
where id = 'f2bbcce2-971d-4dff-b341-03c89f1ac3ef'::uuid
  and not exists (
    select 1 from public.price_observations sale
    where sale.edition_id = 'f2bbcce2-971d-4dff-b341-03c89f1ac3ef'::uuid
  );

insert into public.edition_sources (
  edition_id, source_id, source_record_url, external_id, fields_verified,
  source_data, verification_notes, is_primary
)
select
  'e48009c2-e36c-4b5c-936a-5da4728da55f'::uuid,
  source.id,
  'https://books.shueisha.co.jp/items/contents.html?isbn=978-4-08-881780-4',
  '9784088817804',
  array['title','series','volume_number','author','publisher','language','isbn_13','release_date'],
  jsonb_build_object('rar_catalogue_correction', true, 'reviewed_at', '2026-09-01'),
  'Exact Shueisha record confirms the Japanese paper edition and 4 March 2019 release date. This is publication identity, not printing evidence.',
  true
from public.sources source
where source.name = 'Shueisha Direct'
  and not exists (
    select 1 from public.edition_sources evidence
    where evidence.edition_id = 'e48009c2-e36c-4b5c-936a-5da4728da55f'::uuid
      and evidence.source_record_url = 'https://books.shueisha.co.jp/items/contents.html?isbn=978-4-08-881780-4'
  );

insert into public.edition_sources (
  edition_id, source_id, source_record_url, external_id, fields_verified,
  source_data, verification_notes, is_primary
)
select
  'f2bbcce2-971d-4dff-b341-03c89f1ac3ef'::uuid,
  source.id,
  'https://www.viz.com/manga-books/manga/black-clover-vol-2/product/4860',
  'viz-product-4860',
  array['title','series','volume_number','author','publisher','language','isbn_13','release_date','format'],
  jsonb_build_object('rar_catalogue_correction', true, 'reviewed_at', '2026-09-01'),
  'Exact VIZ product record confirms the English paperback identity, ISBN and 2 August 2016 release date. This is publication identity, not printing evidence.',
  true
from public.sources source
where source.name = 'VIZ Media'
  and not exists (
    select 1 from public.edition_sources evidence
    where evidence.edition_id = 'f2bbcce2-971d-4dff-b341-03c89f1ac3ef'::uuid
      and evidence.source_record_url = 'https://www.viz.com/manga-books/manga/black-clover-vol-2/product/4860'
  );

update public.edition_sources
set is_primary = false
where edition_id in (
  'e48009c2-e36c-4b5c-936a-5da4728da55f'::uuid,
  'f2bbcce2-971d-4dff-b341-03c89f1ac3ef'::uuid
)
and source_record_url like 'https://openlibrary.org/%';

update public.marketplace_search_profiles
set search_query = 'Chainsaw Man manga Vol. 1 Japanese 9784088817804',
    scope_notes = 'RAR-generated eBay profile for Chainsaw Man, Vol. 1, Japanese, Shueisha, ISBN 9784088817804. Keep exact-edition matches only; exclude English copies, other volumes, publishers, bindings, lots, sets and graded copies.',
    last_checked_at = null,
    last_checked_result_count = null,
    updated_at = now()
where edition_id = 'e48009c2-e36c-4b5c-936a-5da4728da55f'::uuid;

update public.marketplace_search_profiles
set search_query = 'Black Clover manga Vol. 2 English 9781421587196',
    scope_notes = 'RAR-generated eBay profile for Black Clover, Vol. 2, English, VIZ Media, ISBN 9781421587196. Keep exact-edition matches only; exclude other volumes, publishers, languages, bindings, lots, sets and graded copies.',
    last_checked_at = null,
    last_checked_result_count = null,
    updated_at = now()
where edition_id = 'f2bbcce2-971d-4dff-b341-03c89f1ac3ef'::uuid;
