-- RAR Portfolio V2: append-only portfolio value history. Purely additive --
-- new table, RLS policies, and an update-blocking trigger. Nothing existing
-- is altered. No fake history is backfilled: the table starts empty and
-- only ever gains rows going forward, one per real snapshot a user (or a
-- future scheduled job) actually requests.
--
-- The valuation itself is deliberately NOT computed in SQL. It reuses the
-- same reviewed TypeScript logic the live dashboard already uses
-- (lib/fx.ts's convertSale, lib/portfolioValuation.ts's summary calc) via
-- a server-side API route -- re-deriving currency conversion and
-- print-classification filtering in PL/pgSQL would duplicate, and risk
-- drifting from, the one already-audited implementation.
create table if not exists public.portfolio_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_at timestamptz not null default now(),
  display_currency text not null check (display_currency in ('GBP', 'EUR', 'USD')),
  -- null means "no purchase price recorded for any holding" / "no holding
  -- has verified market evidence" -- never a fabricated zero.
  total_paid numeric check (total_paid is null or total_paid >= 0),
  -- Amounts that exist but could not be safely combined into total_paid
  -- (different currency, no exchange-rate row for that date), keyed by
  -- currency code -- e.g. {"JPY": 12000.50} -- so nothing is silently
  -- dropped from the historical record.
  paid_excluded_totals jsonb not null default '{}'::jsonb,
  total_evidence_value numeric check (total_evidence_value is null or total_evidence_value >= 0),
  evidence_excluded_totals jsonb not null default '{}'::jsonb,
  -- Only ever set when total_paid and total_evidence_value are both
  -- present, fully combined (no exclusions), and total_paid > 0 -- the
  -- exact same "canCompareGainLoss" rule the live dashboard already
  -- enforces in lib/portfolioValuation.ts.
  gain_loss_amount numeric,
  gain_loss_percent numeric,
  holdings_total_count integer not null default 0,
  holdings_valued_count integer not null default 0,
  holdings_unvalued_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_snapshots_user_time_idx
  on public.portfolio_snapshots(user_id, snapshot_at desc);

alter table public.portfolio_snapshots enable row level security;

-- Same ownership model as portfolio_holdings: a signed-in user reads and
-- creates only their own rows. No update or delete policy exists for the
-- authenticated/anon roles at all -- RLS alone already blocks both by
-- default-deny, and the trigger below adds a second, explicit guard that
-- also covers a service-role connection (which bypasses RLS entirely).
create policy "Users read their own portfolio snapshots"
  on public.portfolio_snapshots for select
  using (auth.uid() = user_id);

create policy "Users create their own portfolio snapshots"
  on public.portfolio_snapshots for insert
  with check (auth.uid() = user_id);

-- Deliberately does not block delete: a user's account being deleted must
-- still cascade-delete their snapshots (see the foreign key above). "Never
-- overwrite or alter" means content mutation, not account cleanup.
create or replace function public.prevent_portfolio_snapshot_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'portfolio_snapshots is append-only; existing snapshots cannot be modified';
end;
$$;

drop trigger if exists portfolio_snapshots_no_update on public.portfolio_snapshots;
create trigger portfolio_snapshots_no_update
  before update on public.portfolio_snapshots
  for each row execute function public.prevent_portfolio_snapshot_update();

-- No automatic scheduling exists yet. This migration and the API route
-- built alongside it (POST /api/portfolio-snapshot) are the foundation
-- only: today, a snapshot is created when a signed-in user's own request
-- triggers it (e.g. opening Performance, or an explicit refresh action).
-- The next step to get real unattended daily history is a scheduled job
-- (e.g. a Vercel Cron route or an external scheduler) that iterates every
-- user with at least one holding and calls the same snapshot logic once a
-- day -- intentionally not implemented here rather than pretended into
-- existence.
