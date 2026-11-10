-- Return to the watch cycle the listings RAR gave up on while they were still
-- for sale.
--
-- WHY
-- An earlier version of the outcome worker ran its short retry schedule
-- (30 min .. 7 days, 5 attempts) and then recorded "ambiguous" even when the
-- last answer from eBay Trading GetItem was that the listing was still ACTIVE.
-- On 10 Nov 2026 that was 1,732 rows, all fixed-price (some with Best Offer),
-- which can stay live for months and sell later. Their check detail reads
-- "eBay Trading GetItem never confirmed an outcome after N checks. Recorded as
-- unknown rather than guessed." with listing_state 'active'. They were never
-- unknowable; they simply had not ended. The worker now keeps such listings on
-- a 7-day recheck cadence (STILL_LIVE_RECHECK_DAYS, up to MAX_WATCH_DAYS from
-- first_seen_at), claimed only after every newly ended or never-checked
-- listing, inside the unchanged daily budget.
--
-- WHAT IT DOES
-- For exactly the rows that are status 'ambiguous', have no human review and
-- no resulting sale, and whose MOST RECENT listing_outcome_checks row is an
-- 'eBay Trading GetItem' check with listing_state 'active', resulting_status
-- 'ambiguous' and the "never confirmed an outcome after N checks" detail:
--   * status 'active', check_attempts 0, last_error null;
--   * next_check_at spread evenly over the next 7 days by row_number (stalest
--     check first), so about a seventh come due each day, not all at once;
--   * scheduled_end_at cleared only when it is already in the past (it is a
--     stale end time for a listing eBay later reported live; left in place it
--     would promote every row into the first-priority lane at once);
--   * one listing_outcome_checks row each, provider
--     'RAR correction — still live, returned to watch', in the same style as the
--     earlier 'RAR correction — malformed item id' audit rows, with the
--     previous values in raw_response so the change can be undone.
-- It creates no sale, no sold candidate and no observation.
--
-- WHAT IT DOES NOT TOUCH
--   * any row whose latest check came from a person ('human review',
--     'eBay page — staff observed…', '130point manual corroboration', ...) or
--     whose listing_outcomes.reviewed_by / reviewed_at is set;
--   * any row with a resulting_observation_id;
--   * Best Offer "accepted price not disclosed" rows (their latest check is
--     completed_sold, and their reason starts 'Best Offer listing:');
--   * any row in another status (active, unsold, review_complete, ...).
--
-- DEPLOY ORDER
-- Deploy the application code first. The older worker never claims 'active'
-- rows by next_check_at, and its "unseen for 7 days" promotion would pull all
-- of these into the check queue on its next run instead of over 7 days.
-- Budget note: reserve_outcome_checks counts every listing_outcome_checks row
-- written today as spent, so the audit rows written here reduce that UTC
-- day's remaining outcome-check allowance by the same number (never raise
-- it). Applying late in the UTC day, after the daily cron, costs nothing.
--
-- IDEMPOTENT: after one run every target's latest check is the correction row
-- and its status is 'active', so a second run matches nothing.
--
-- UNDO (only rows still exactly as this migration left them):
--   update public.listing_outcomes o
--      set status = c.raw_response->>'previous_status',
--          check_attempts = (c.raw_response->>'previous_attempts')::int,
--          next_check_at = (c.raw_response->>'previous_next_check_at')::timestamptz,
--          scheduled_end_at = (c.raw_response->>'previous_scheduled_end_at')::timestamptz,
--          outcome_reason = c.raw_response->>'previous_reason',
--          outcome_provider = c.raw_response->>'previous_provider',
--          last_error = c.raw_response->>'previous_last_error',
--          updated_at = now()
--     from public.listing_outcome_checks c
--    where c.outcome_id = o.id
--      and c.provider = 'RAR correction — still live, returned to watch'
--      and o.status = 'active' and o.check_attempts = 0
--      and o.reviewed_by is null and o.resulting_observation_id is null
--      and not exists (select 1 from public.listing_outcome_checks later
--                       where later.outcome_id = o.id and later.checked_at > c.checked_at);
-- (The correction audit rows are left in place as history.)

begin;

create temp table outcome_still_live_requeue on commit drop as
with latest as (
  select distinct on (c.outcome_id)
         c.outcome_id, c.provider, c.listing_state, c.resulting_status, c.detail
    from public.listing_outcome_checks c
   order by c.outcome_id, c.checked_at desc, c.id desc
),
targets as (
  select o.id, o.check_attempts, o.next_check_at, o.scheduled_end_at,
         o.outcome_reason, o.outcome_provider, o.last_error, o.last_checked_at
    from public.listing_outcomes o
    join latest l on l.outcome_id = o.id
   where o.status = 'ambiguous'
     and o.reviewed_by is null
     and o.reviewed_at is null
     and o.resulting_observation_id is null
     and l.provider = 'eBay Trading GetItem'
     and l.listing_state = 'active'
     and l.resulting_status = 'ambiguous'
     and l.detail like 'eBay Trading GetItem never confirmed an outcome after % checks.%'
     and coalesce(o.outcome_reason, '') not like 'Best Offer listing:%'
     for update of o
)
select t.*,
       row_number() over (order by t.last_checked_at nulls first, t.id) as rn,
       count(*) over () as total,
       now() as run_at
  from targets t;

insert into public.listing_outcome_checks
  (outcome_id, provider, attempt_number, http_status, listing_state, resulting_status, detail, raw_response, checked_at)
select r.id,
       'RAR correction — still live, returned to watch',
       coalesce(r.check_attempts, 0) + 1,
       null,
       'active',
       'active',
       'Returned to watching: the last eBay Trading GetItem answer said this listing was still for sale, so recording it as unknown after the short retry schedule was wrong. It will be rechecked every 7 days until it ends, or for up to 365 days from when RAR first saw it. No sale or price was created.',
       jsonb_build_object(
         'correction', 'requeue_still_live_after_exhaustion',
         'migration', '20261111_outcome_requeue_still_live',
         'previous_status', 'ambiguous',
         'previous_attempts', r.check_attempts,
         'previous_next_check_at', r.next_check_at,
         'previous_scheduled_end_at', r.scheduled_end_at,
         'previous_reason', r.outcome_reason,
         'previous_provider', r.outcome_provider,
         'previous_last_error', r.last_error),
       r.run_at
  from outcome_still_live_requeue r;

update public.listing_outcomes o
   set status = 'active',
       check_attempts = 0,
       -- Even spread across (run_at, run_at + 7 days]: row k of n is due at
       -- run_at + 7 days * k / n.
       next_check_at = r.run_at + interval '7 days' * (r.rn::numeric / r.total::numeric),
       scheduled_end_at = case when o.scheduled_end_at > r.run_at then o.scheduled_end_at else null end,
       last_error = null,
       outcome_reason = 'Returned to watching: eBay Trading GetItem last reported this listing still for sale. Rechecked every 7 days until it ends.',
       outcome_provider = 'RAR correction — still live, returned to watch',
       updated_at = r.run_at
  from outcome_still_live_requeue r
 where o.id = r.id
   and o.status = 'ambiguous'
   and o.reviewed_by is null
   and o.resulting_observation_id is null;

do $$
declare
  v_expected integer;
  v_bad integer;
  v_audits integer;
begin
  select count(*) into v_expected from outcome_still_live_requeue;
  select count(*) into v_bad
    from outcome_still_live_requeue r
    join public.listing_outcomes o on o.id = r.id
   where not (
     o.status = 'active'
     and o.check_attempts = 0
     and o.reviewed_by is null
     and o.resulting_observation_id is null
     and o.next_check_at > r.run_at
     and o.next_check_at <= r.run_at + interval '7 days'
     and o.outcome_provider = 'RAR correction — still live, returned to watch');
  select count(*) into v_audits
    from outcome_still_live_requeue r
    join public.listing_outcome_checks c
      on c.outcome_id = r.id
     and c.provider = 'RAR correction — still live, returned to watch'
     and c.checked_at = r.run_at;
  if v_bad <> 0 or v_audits <> v_expected
     or (select count(*) from public.listing_outcomes o join outcome_still_live_requeue r on r.id = o.id) <> v_expected then
    raise exception 'Still-live requeue check failed: % targeted, % not in the expected state, % audit rows. Rolled back.',
      v_expected, v_bad, v_audits;
  end if;
end;
$$;

select count(*) as requeued,
       min(o.next_check_at) as first_next_check_at,
       max(o.next_check_at) as last_next_check_at
  from outcome_still_live_requeue r
  join public.listing_outcomes o on o.id = r.id;

commit;
