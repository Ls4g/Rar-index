-- Seed only catalogue-ready Vol. 1 editions. Each profile is an exact ISBN
-- search specification; it cannot create, verify, or value a sale by itself.
insert into public.marketplace_search_profiles (
  edition_id,
  source_id,
  search_query,
  scope_notes,
  collection_interval_days
)
select
  edition.id,
  source.id,
  format('"%s"', edition.isbn_13),
  case
    when edition.printing_number is not null then format(
      'Completed listings only. Exact ISBN %s. This is a specific printing record: use source-page evidence and copyright-page proof before accepting a sale as this printing. Exclude variants and graded copies from the raw-sale workflow.',
      edition.isbn_13
    )
    else format(
      'Completed listings only. Standard edition, exact ISBN %s. Treat every candidate as unverified until its source page and edition clues are reviewed. Do not use this profile for a specific printing, variant, or graded copy. A first-print sale needs a separate inspected record with copyright-page proof of 第1刷.',
      edition.isbn_13
    )
  end,
  14
from public.manga_editions edition
join public.sources source on source.name = 'eBay Sold'
where edition.is_verified
  and edition.volume_number = '1'
  and edition.isbn_13 is not null
  and edition.publisher is not null
  and edition.release_date is not null
  and exists (select 1 from public.edition_sources evidence where evidence.edition_id = edition.id)
  and not exists (
    select 1
    from public.marketplace_search_profiles profile
    where profile.edition_id = edition.id
      and profile.source_id = source.id
      and profile.is_active
  )
on conflict (edition_id, source_id, search_query) do nothing;
