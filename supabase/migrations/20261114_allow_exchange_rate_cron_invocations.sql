-- Let the exchange-rates job record its runs like the other six, so a
-- failure there shows up in the staff job-health alert instead of nowhere.
-- Widens the allowed route list only; no rows change.
alter table public.cron_invocations
  drop constraint cron_invocations_route_check,
  add constraint cron_invocations_route_check check (route in (
    '/api/cron/ebay-scout',
    '/api/cron/portfolio-snapshots',
    '/api/cron/rar-agents',
    '/api/cron/agent-reliability',
    '/api/cron/listing-outcomes',
    '/api/cron/apify-sales',
    '/api/cron/exchange-rates'
  ));
