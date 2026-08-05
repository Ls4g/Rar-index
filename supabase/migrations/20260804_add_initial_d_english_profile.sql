-- Pricing coverage sprint: Initial D Vol. 1 English had no eBay Sold search
-- profile at all, unlike its Japanese sibling and every other target
-- edition. Query follows the same standardised pattern as the 2026-08-03
-- profile standardisation (series, manga, Vol., language, ISBN).
insert into public.marketplace_search_profiles (
  edition_id, source_id, search_query, scope_notes, collection_interval_days
)
select
  edition.id,
  source.id,
  'Initial D manga Vol. 1 English 9781931514989',
  'Completed listings only. Standard edition, exact ISBN 9781931514989. Review each source page before accepting it. Do not use this profile for a specific printing, variant, or graded copy; a first-print claim needs a separate inspected record with copyright-page proof.',
  14
from public.manga_editions edition
join public.sources source on source.name = 'eBay Sold'
where edition.id = 'f96499c3-ee28-405f-95a4-8c19ea4e124d'::uuid
on conflict do nothing;
