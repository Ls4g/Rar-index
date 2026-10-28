-- The daily Apify sold-search job uses runRecordedCron, but the original
-- route check predates it. Keep every existing route and allow the new one.
-- This changes only the check constraint; no run or sale rows are touched.
begin;

alter table public.cron_invocations
  drop constraint cron_invocations_route_check,
  add constraint cron_invocations_route_check check (route in (
    '/api/cron/ebay-scout',
    '/api/cron/portfolio-snapshots',
    '/api/cron/rar-agents',
    '/api/cron/agent-reliability',
    '/api/cron/listing-outcomes',
    '/api/cron/apify-sales'
  ));

commit;
