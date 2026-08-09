-- Purely additive: one nullable column recording *why* a snapshot was
-- created, now that snapshots are taken automatically from several
-- different triggers (adding/editing/removing a holding, verified evidence
-- changing, the daily cron) instead of a single manual button. Existing
-- rows get null, which the check constraint explicitly allows -- nothing
-- about them is reinterpreted or backfilled.
alter table public.portfolio_snapshots
  add column if not exists trigger_reason text;

alter table public.portfolio_snapshots
  add constraint portfolio_snapshots_trigger_reason_check
  check (trigger_reason is null or trigger_reason in (
    'holding_added', 'holding_updated', 'holding_removed',
    'evidence_changed', 'daily_cron'
  ));
