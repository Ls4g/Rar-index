-- Read the active Scout backlog in one database round trip. PostgREST caps
-- ordinary table reads at 1,000 rows, forcing the staff page to make many
-- sequential requests before it can calculate its review views.
create or replace function public.scout_active_leads_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', lead.id,
    'profile_id', lead.profile_id,
    'source_id', lead.source_id,
    'external_id', lead.external_id,
    'source_listing_url', lead.source_listing_url,
    'listing_title', lead.listing_title,
    'listing_price', lead.listing_price,
    'currency', lead.currency,
    'listing_condition', lead.listing_condition,
    'item_end_at', lead.item_end_at,
    'first_seen_at', lead.first_seen_at,
    'last_seen_at', lead.last_seen_at,
    'buying_options', lead.raw_payload #> '{item,buyingOptions}',
    'review_status', lead.review_status,
    'review_notes', lead.review_notes,
    'reviewed_by', lead.reviewed_by
  ) order by lead.last_seen_at desc, lead.id), '[]'::jsonb)
  from public.scout_listing_leads lead
  join public.marketplace_search_profiles profile on profile.id = lead.profile_id
  where profile.is_active = true
    and lead.review_status in ('new', 'watching');
$$;

revoke all on function public.scout_active_leads_snapshot() from public, anon, authenticated;
grant execute on function public.scout_active_leads_snapshot() to service_role;
