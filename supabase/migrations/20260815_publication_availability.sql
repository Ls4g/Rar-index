-- "Can I still buy this?" — answered from what RAR actually observed.
--
-- RAR does not and cannot say a book is out of print: that is a fact about a
-- publisher's intentions and RAR has no publisher feed. Inferring it from
-- silence would be an invented claim. What RAR can state is its own
-- observation record — how many times Scout completed a check, when it last
-- saw a copy listed, and how many are live now — which answers the same
-- practical question and cannot be wrong.
--
-- This view is the observation record, per edition. It carries counts and
-- timestamps only; the wording built on top of it lives in lib/availability.ts
-- so the caveat travels with the number.
--
-- Purely additive: one view over tables that already exist.

create or replace view public.publication_availability
with (security_invoker = false) as
  select
    profile.edition_id,
    count(distinct profile.id) filter (where profile.is_active)            as active_profiles,
    count(distinct scan.id) filter (where scan.status = 'completed')       as completed_scans,
    max(scan.scanned_at) filter (where scan.status = 'completed')          as last_scan_at,
    count(distinct lead.id)                                                as leads_ever_seen,
    max(lead.last_seen_at)                                                 as last_lead_seen_at,
    -- Live means seen in the last 48 hours and either open-ended (a
    -- fixed-price listing) or not yet past its end time. Same freshness rule
    -- the homepage and edition page already apply to Scout leads.
    count(distinct lead.id) filter (
      where lead.last_seen_at >= now() - interval '48 hours'
        and (lead.item_end_at is null or lead.item_end_at > now())
    )                                                                      as live_now
  from public.marketplace_search_profiles profile
  left join public.scout_scans scan on scan.profile_id = profile.id
  left join public.scout_listing_leads lead on lead.profile_id = profile.id
  group by profile.edition_id;

comment on view public.publication_availability is
  'Scout observation record per edition: how often RAR checked, when it last saw a listing, how many are live. Deliberately states no out-of-print claim -- RAR has no publisher feed and never infers one from silence.';

grant select on public.publication_availability to anon, authenticated;
