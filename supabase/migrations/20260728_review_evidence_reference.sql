-- Surface an optional, listing-specific copyright-page reference in the protected review queue.
-- The importer stores this nested value in raw_payload so existing observations stay untouched.
create or replace view public.price_review_queue as
select
  po.id as observation_id,
  po.match_status,
  po.listing_title,
  po.source_listing_url,
  po.sold_date,
  po.sale_price,
  po.currency,
  po.item_condition,
  po.is_sealed,
  po.notes as match_notes,
  po.created_at as queued_at,
  e.id as edition_id,
  e.title as edition_title,
  e.series as edition_series,
  e.volume_number as edition_volume_number,
  e.language as edition_language,
  e.isbn_13 as edition_isbn_13,
  e.edition_statement,
  e.printing_number,
  s.name as source_name,
  po.raw_payload -> 'rar_import_metadata' ->> 'evidence_image_url' as evidence_image_url
from public.price_observations po
join public.manga_editions e on e.id = po.edition_id
join public.sources s on s.id = po.source_id
where po.match_status = 'needs_review'
order by po.created_at;
