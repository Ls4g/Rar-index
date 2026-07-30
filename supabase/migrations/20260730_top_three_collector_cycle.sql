-- Complete the evidence-first catalogue and collection foundation for the
-- three collector-priority Japanese Vol. 1 records. This migration does not
-- claim a specific printing where a copyright-page inspection is absent.

insert into public.sources (name, base_url, source_type, trust_tier, is_active)
values
  ('Shueisha Direct', 'https://books.shueisha.co.jp', 'publisher', 1, true)
on conflict (name) do nothing;

-- Official publisher bibliographies establish the standard edition identity,
-- not the existence of an individual first printing.
with source as (
  select id from public.sources where name = 'Shueisha Direct'
), evidence as (
  select * from (values
    (
      '003d336e-38be-411a-8e86-bc2427204b40'::uuid,
      'https://books.shueisha.co.jp/items/contents.html?isbn=978-4-08-872571-0',
      '9784088725710',
      jsonb_build_object(
        'source_kind', 'official_publisher_bibliography',
        'title', 'HUNTERxHUNTER 1',
        'author', 'Yoshihiro Togashi',
        'publisher', 'Shueisha',
        'imprint', 'Jump Comics',
        'isbn_13', '9784088725710',
        'paper_release_date', '1998-06-04',
        'format', 'Shinsho',
        'pages', 192
      ),
      'Official Shueisha bibliography confirms the standard Japanese Jump Comics Vol. 1, ISBN 9784088725710, released 4 June 1998. It does not prove a specific printing; first-print claims require copyright-page proof.'
    ),
    (
      'f177a6c3-d315-4767-b30e-648274108d46'::uuid,
      'https://books.shueisha.co.jp/items/contents.html?isbn=978-4-08-881516-9',
      '9784088815169',
      jsonb_build_object(
        'source_kind', 'official_publisher_bibliography',
        'title', 'Jujutsu Kaisen 1',
        'author', 'Gege Akutami',
        'publisher', 'Shueisha',
        'imprint', 'Jump Comics',
        'isbn_13', '9784088815169',
        'paper_release_date', '2018-07-04',
        'format', 'Shinsho',
        'pages', 192
      ),
      'Official Shueisha bibliography confirms the standard Japanese Jump Comics Vol. 1, ISBN 9784088815169, released 4 July 2018. It does not prove a specific printing; first-print claims require copyright-page proof.'
    ),
    (
      '451b945f-1772-440c-9d97-1d0f64009e18'::uuid,
      'https://books.shueisha.co.jp/items/contents.html?isbn=978-4-08-883819-9',
      '9784088838199',
      jsonb_build_object(
        'source_kind', 'official_publisher_bibliography',
        'title', 'Kagurabachi 1',
        'author', 'Takeru Hokazono',
        'publisher', 'Shueisha',
        'imprint', 'Jump Comics',
        'isbn_13', '9784088838199',
        'paper_release_date', '2024-02-02',
        'format', 'Shinsho',
        'pages', 216
      ),
      'Official Shueisha bibliography confirms the standard Japanese Jump Comics Vol. 1, ISBN 9784088838199, released 2 February 2024. It does not prove a specific printing; first-print claims require copyright-page proof.'
    )
  ) as rows(edition_id, source_record_url, external_id, source_data, verification_notes)
)
insert into public.edition_sources (
  edition_id, source_id, source_record_url, external_id, fields_verified,
  source_data, verification_notes, is_primary
)
select
  evidence.edition_id,
  source.id,
  evidence.source_record_url,
  evidence.external_id,
  array['title', 'author', 'isbn', 'publisher', 'release_date', 'format'],
  evidence.source_data,
  evidence.verification_notes,
  false
from evidence
cross join source
where not exists (
  select 1
  from public.edition_sources existing
  where existing.edition_id = evidence.edition_id
    and existing.source_record_url = evidence.source_record_url
);

update public.manga_editions
set historical_notes = case id
  when '003d336e-38be-411a-8e86-bc2427204b40'::uuid then
    'Official Shueisha bibliography confirms the standard Japanese Jump Comics Vol. 1 and its 4 June 1998 release. This ISBN record is not proof of a specific printing; a first-print record needs copyright-page evidence.'
  when 'f177a6c3-d315-4767-b30e-648274108d46'::uuid then
    'Official Shueisha bibliography confirms the standard Japanese Jump Comics Vol. 1 and its 4 July 2018 release. A particular printing needs separate copyright-page evidence.'
  when '451b945f-1772-440c-9d97-1d0f64009e18'::uuid then
    'Official Shueisha bibliography confirms the standard Japanese Jump Comics Vol. 1 and its 2 February 2024 release. A particular printing needs separate copyright-page evidence.'
  else historical_notes
end,
importance_tags = array['first_volume', 'jump_comics', 'weekly_shonen_jump']
where id in (
  '003d336e-38be-411a-8e86-bc2427204b40'::uuid,
  'f177a6c3-d315-4767-b30e-648274108d46'::uuid,
  '451b945f-1772-440c-9d97-1d0f64009e18'::uuid
);

-- Profiles and completed-search audit records make the marketplace process
-- repeatable. A result count is collection evidence, never a price claim.
insert into public.marketplace_search_profiles (
  edition_id, source_id, search_query, scope_notes, collection_interval_days
)
select
  edition.id,
  source.id,
  format('"%s"', edition.isbn_13),
  format(
    'Completed listings only. Standard edition, exact ISBN %s. Review each source page before accepting it. Do not use this profile for a specific printing, variant, or graded copy; a first-print claim needs a separate inspected record with copyright-page proof.',
    edition.isbn_13
  ),
  14
from public.manga_editions edition
join public.sources source on source.name = 'eBay Sold'
where edition.id in (
  '003d336e-38be-411a-8e86-bc2427204b40'::uuid,
  'f177a6c3-d315-4767-b30e-648274108d46'::uuid,
  '451b945f-1772-440c-9d97-1d0f64009e18'::uuid
)
on conflict (edition_id, source_id, search_query) do nothing;

with completed_searches as (
  select * from (values
    ('003d336e-38be-411a-8e86-bc2427204b40'::uuid, 23, 'Manual eBay Sold search, exact ISBN, performed 2026-07-30. 23 results. Candidate listings require normal edition review; the search itself did not verify a sale.'),
    ('f177a6c3-d315-4767-b30e-648274108d46'::uuid, 20, 'Manual eBay Sold search, exact ISBN, performed 2026-07-30. 20 results. Candidate listings require normal edition review; the search itself did not verify a sale.'),
    ('451b945f-1772-440c-9d97-1d0f64009e18'::uuid, 24, 'Manual eBay Sold search, exact ISBN, performed 2026-07-30. 24 results. Candidate listings require normal edition review; the search itself did not verify a sale.')
  ) as rows(edition_id, candidate_count, notes)
)
insert into public.marketplace_collection_runs (profile_id, checked_by, candidate_count, notes)
select profile.id, 'RAR staff', completed_searches.candidate_count, completed_searches.notes
from completed_searches
join public.marketplace_search_profiles profile on profile.edition_id = completed_searches.edition_id
join public.sources source on source.id = profile.source_id and source.name = 'eBay Sold'
where not exists (
  select 1 from public.marketplace_collection_runs run
  where run.profile_id = profile.id
    and run.notes = completed_searches.notes
);

-- One completed, exact-ISBN Jujutsu Kaisen sale is added as an accountable
-- manual import and then reviewed. It is a standard-edition sale, not a
-- first-print claim; the raw payload intentionally preserves the listing's
-- inconsistent language item-specific so future reviewers can inspect it.
do $$
declare
  v_source_id uuid;
  v_run_id uuid;
  v_observation_id uuid;
begin
  select id into v_source_id from public.sources where name = 'eBay Sold';
  select run.id into v_run_id
  from public.marketplace_collection_runs run
  join public.marketplace_search_profiles profile on profile.id = run.profile_id
  where profile.edition_id = 'f177a6c3-d315-4767-b30e-648274108d46'::uuid
    and profile.source_id = v_source_id
  order by run.checked_at desc
  limit 1;

  if v_source_id is null or v_run_id is null then
    raise exception 'The eBay source and Jujutsu Kaisen collection run are required before importing the sale.';
  end if;

  insert into public.price_observations (
    edition_id, collection_run_id, source_id, source_listing_url, external_id,
    listing_title, sold_date, sale_price, currency, shipping_price, quantity,
    sale_type, item_condition, is_sealed, raw_payload, is_verified,
    match_status, sale_status, notes
  ) values (
    'f177a6c3-d315-4767-b30e-648274108d46'::uuid,
    v_run_id,
    v_source_id,
    'https://www.ebay.com/itm/407062208134',
    '407062208134',
    'Jujutsu Kaisen 1 (Japanese Edition) - Comic, by Sukune Ryomen - Very Good',
    '2026-07-22'::date,
    7.21,
    'USD',
    7.67,
    1,
    'fixed_price',
    'Very Good',
    false,
    jsonb_build_object(
      'captured_from', 'manual_ebay_sold_review',
      'evidence', jsonb_build_object(
        'sold_result', 'Sold Jul 22, 2026',
        'isbn_13', '9784088815169',
        'publisher', 'Shueisha',
        'country_of_origin', 'Japan',
        'listing_title_language', 'Japanese',
        'item_specific_language', 'English'
      ),
      'rar_import_metadata', jsonb_build_object(
        'contract_version', 'marketplace-csv-v1',
        'candidate', jsonb_build_object(
          'title', 'Jujutsu Kaisen',
          'series', 'Jujutsu Kaisen',
          'volume_number', '1',
          'language', 'Japanese',
          'isbn_13', '9784088815169',
          'publisher', 'Shueisha',
          'format', null
        ),
        'evidence_image_url', null,
        'edition_match', jsonb_build_object(
          'source', 'manual exact-ISBN review',
          'score', 100,
          'confidence', 'high'
        )
      )
    ),
    false,
    'needs_review',
    'confirmed',
    'Manually captured from an eBay Sold exact-ISBN search. Awaiting exact-edition review; listing item specifics contained a conflicting language field.'
  )
  on conflict (source_id, external_id) do nothing
  returning id into v_observation_id;

  if v_observation_id is null then
    select id into v_observation_id
    from public.price_observations
    where source_id = v_source_id and external_id = '407062208134';
  end if;

  if not exists (
    select 1 from public.price_review_decisions
    where observation_id = v_observation_id and decision = 'verified_match'
  ) then
    perform public.apply_price_review(
      v_observation_id,
      'verified_match',
      'The completed eBay listing records exact ISBN 9784088815169, Shueisha, and Japan origin. Its title identifies the Japanese edition; the conflicting item-specific language is preserved in the evidence payload. This verifies the standard Japanese Vol. 1 record only, not a specific printing.',
      'RAR staff'
    );
  end if;
end;
$$;
