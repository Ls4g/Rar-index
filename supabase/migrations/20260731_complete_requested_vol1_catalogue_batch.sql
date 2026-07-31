-- Complete the catalogue readiness pass for the requested Vol. 1 batch.
--
-- These are standard edition records only. An official catalogue page proves
-- the edition identity and paper release date; it does not prove any specific
-- printing. First-print records still require separate copyright-page evidence.

with reviewed_records as (
  select * from (values
    ('9781612620244', '2012-06-19'::date, 'Kodansha USA', 'https://archive.kodansha.us/volume/attack-on-titan-1/index.html'),
    ('9784063842760', '2010-03-17'::date, 'Kodansha Japan', 'https://www.kodansha.co.jp/comic/products/0000017064'),
    ('9781421587189', '2016-06-07'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/black-clover-volume-1/product/4795'),
    ('9781974700523', '2018-07-03'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/demon-slayer-kimetsu-no-yaiba-volume-1/product/5547'),
    ('9781591167532', '2005-04-05'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/hunter-x-hunter-volume-1/product/339/paperback'),
    ('9784063235678', '1995-11-02'::date, 'Kodansha Japan', 'https://www.kodansha.co.jp/comic/products/0000006854'),
    ('9781974710027', '2019-12-03'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/jujutsu-kaisen-volume-1-0/product/6116/paperback'),
    ('9781974747245', '2024-11-05'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/kagurabachi-volume-1/product/8072')
  ) as rows(isbn_13, release_date, source_name, source_record_url)
)
update public.manga_editions edition
set release_date = reviewed_records.release_date
from reviewed_records
where edition.isbn_13 = reviewed_records.isbn_13
  and edition.release_date is null;

with reviewed_records as (
  select * from (values
    ('9781612620244', '2012-06-19'::date, 'Kodansha USA', 'https://archive.kodansha.us/volume/attack-on-titan-1/index.html'),
    ('9784063842760', '2010-03-17'::date, 'Kodansha Japan', 'https://www.kodansha.co.jp/comic/products/0000017064'),
    ('9781421587189', '2016-06-07'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/black-clover-volume-1/product/4795'),
    ('9781974700523', '2018-07-03'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/demon-slayer-kimetsu-no-yaiba-volume-1/product/5547'),
    ('9781591167532', '2005-04-05'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/hunter-x-hunter-volume-1/product/339/paperback'),
    ('9784063235678', '1995-11-02'::date, 'Kodansha Japan', 'https://www.kodansha.co.jp/comic/products/0000006854'),
    ('9781974710027', '2019-12-03'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/jujutsu-kaisen-volume-1-0/product/6116/paperback'),
    ('9781974747245', '2024-11-05'::date, 'VIZ Media', 'https://www.viz.com/manga-books/manga/kagurabachi-volume-1/product/8072')
  ) as rows(isbn_13, release_date, source_name, source_record_url)
)
update public.edition_sources evidence
set fields_verified = array(
      select distinct field
      from unnest(coalesce(evidence.fields_verified, array[]::text[]) || array['release_date']) as field
      order by field
    ),
    source_data = coalesce(evidence.source_data, '{}'::jsonb) || jsonb_build_object(
      'rar_catalogue_review', jsonb_build_object(
        'reviewed_by', 'RAR staff',
        'reviewed_at', '2026-07-31',
        'paper_release_date', reviewed_records.release_date,
        'scope', 'Standard edition identity and paper release date only; not printing evidence.'
      )
    ),
    verification_notes = concat_ws(' ', evidence.verification_notes,
      'RAR staff cross-checked the paper release date against this official publisher record on 31 July 2026. This remains standard-edition evidence only, not printing proof.'
    )
from reviewed_records
join public.manga_editions edition on edition.isbn_13 = reviewed_records.isbn_13
join public.sources source on source.name = reviewed_records.source_name
where evidence.edition_id = edition.id
  and evidence.source_id = source.id
  and evidence.source_record_url = reviewed_records.source_record_url;

-- A catalogue-ready standard edition receives a repeatable search profile.
-- The profile only finds candidates; no result affects price until reviewed.
insert into public.marketplace_search_profiles (
  edition_id, source_id, search_query, scope_notes, collection_interval_days
)
select
  edition.id,
  marketplace.id,
  format('"%s"', edition.isbn_13),
  format(
    'Completed listings only. Standard edition, exact ISBN %s. Treat every candidate as unverified until the source page and edition clues are reviewed. Do not use this profile for a specific printing, variant, or graded copy. A first-print sale needs separate copyright-page evidence.',
    edition.isbn_13
  ),
  14
from public.manga_editions edition
join public.sources marketplace on marketplace.name = 'eBay Sold'
where edition.isbn_13 in (
  '9781612620244', '9784063842760', '9781421587189', '9781974700523',
  '9781591167532', '9784063235678', '9781974710027', '9781974747245'
)
  and edition.is_verified
  and edition.volume_number = '1'
  and edition.release_date is not null
  and exists (select 1 from public.edition_sources evidence where evidence.edition_id = edition.id)
  and not exists (
    select 1
    from public.marketplace_search_profiles profile
    where profile.edition_id = edition.id
      and profile.source_id = marketplace.id
      and profile.search_query = format('"%s"', edition.isbn_13)
  );
