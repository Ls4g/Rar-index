-- The public alpha catalogue is evidence-gated. A record must be a reviewed
-- edition with core identity fields and at least one linked source record.
-- Market history remains optional: price evidence is deliberately a smaller,
-- separate subset of the catalogue. This is a deliberately narrow public
-- projection; it does not expose source payloads or internal review notes.
create or replace view public.alpha_catalogue_v1
with (security_invoker = false)
as
select
  edition.id,
  edition.title,
  edition.series,
  edition.volume_number,
  edition.author,
  edition.publisher,
  edition.language,
  edition.isbn_13,
  edition.release_date,
  edition.format,
  edition.edition_statement,
  edition.printing_number,
  edition.variant_name,
  edition.collectible_type,
  edition.created_at,
  count(distinct evidence.id)::integer as source_count,
  count(distinct observation.id) filter (
    where observation.match_status = 'verified_match'
      and observation.sale_status = 'confirmed'
  )::integer as verified_sale_count,
  exists (
    select 1
    from public.marketplace_search_profiles profile
    where profile.edition_id = edition.id
      and profile.is_active
  ) as is_search_ready
from public.manga_editions edition
join public.edition_sources evidence on evidence.edition_id = edition.id
left join public.price_observations observation on observation.edition_id = edition.id
where edition.is_verified
  and edition.isbn_13 is not null
  and edition.publisher is not null
  and edition.release_date is not null
group by edition.id;
