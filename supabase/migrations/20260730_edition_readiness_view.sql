-- Readiness is calculated from real evidence and workflow records, never set
-- manually. It lets staff scale the catalogue without losing track of trust.
create or replace view public.edition_readiness as
with evidence as (
  select edition_id, count(*)::integer as evidence_count
  from public.edition_sources
  group by edition_id
),
profiles as (
  select edition_id, count(*) filter (where is_active)::integer as active_profile_count
  from public.marketplace_search_profiles
  group by edition_id
),
runs as (
  select profile.edition_id, count(run.id)::integer as collection_run_count
  from public.marketplace_search_profiles profile
  left join public.marketplace_collection_runs run on run.profile_id = profile.id
  group by profile.edition_id
),
sales as (
  select
    edition_id,
    count(*) filter (where match_status = 'verified_match' and sale_status = 'confirmed')::integer as verified_sale_count,
    count(*) filter (where match_status = 'needs_review')::integer as review_sale_count
  from public.price_observations
  group by edition_id
)
select
  edition.id as edition_id,
  edition.title,
  edition.series,
  edition.volume_number,
  edition.language,
  edition.isbn_13,
  edition.publisher,
  edition.release_date,
  edition.printing_number,
  edition.is_verified,
  coalesce(evidence.evidence_count, 0) as evidence_count,
  coalesce(profiles.active_profile_count, 0) as active_profile_count,
  coalesce(runs.collection_run_count, 0) as collection_run_count,
  coalesce(sales.verified_sale_count, 0) as verified_sale_count,
  coalesce(sales.review_sale_count, 0) as review_sale_count,
  case
    when not edition.is_verified then 'needs_catalogue_review'
    when edition.isbn_13 is null or edition.publisher is null or edition.release_date is null then 'catalogue_incomplete'
    when coalesce(evidence.evidence_count, 0) = 0 then 'evidence_needed'
    when coalesce(profiles.active_profile_count, 0) = 0 then 'profile_needed'
    when coalesce(runs.collection_run_count, 0) = 0 then 'search_ready'
    when coalesce(sales.review_sale_count, 0) > 0 then 'under_review'
    when coalesce(sales.verified_sale_count, 0) > 0 then 'valuation_ready'
    else 'collecting'
  end as readiness_status
from public.manga_editions edition
left join evidence on evidence.edition_id = edition.id
left join profiles on profiles.edition_id = edition.id
left join runs on runs.edition_id = edition.id
left join sales on sales.edition_id = edition.id;
