-- Watch-to-Sale: remember a live listing, revisit it after it ends, and put
-- only genuine sold candidates in front of a human.
--
-- Additive throughout. No existing sale, Scout lead or review decision is
-- touched, and nothing here can create verified evidence on its own.
--
-- Why its own table rather than more columns on scout_listing_leads: a Scout
-- lead is a buying opportunity and is deliberately disposable -- storeScoutLeads
-- deletes unreviewed surplus leads to keep the queue at 20 a profile. A watched
-- listing must survive exactly that, because the whole point is to still be
-- holding the original snapshot weeks later when eBay no longer serves the
-- page. Putting them in one table would mean the cap silently eating the
-- pipeline's inputs.

create table if not exists public.listing_outcomes (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id),
  -- eBay's own listing id. Unique per marketplace, which is why both are in
  -- the key: the same number can exist on ebay.com and ebay.co.uk.
  external_id text not null,
  marketplace text not null default 'EBAY_GB',
  source_listing_url text not null,

  profile_id uuid references public.marketplace_search_profiles(id) on delete set null,
  edition_id uuid not null references public.manga_editions(id) on delete cascade,

  listing_title text not null,
  image_url text,
  asking_price numeric,
  currency text,
  buying_format text,
  bid_count integer,
  scheduled_end_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- The listing exactly as RAR saw it while live. Kept whatever eBay does
  -- afterwards: a reviewer weeks later needs to see what was actually on
  -- offer, and eBay will not tell them.
  original_snapshot jsonb not null default '{}'::jsonb,
  -- The match assessment as at capture, so a scoring change cannot silently
  -- rewrite the basis on which something was queued.
  match_assessment jsonb not null default '{}'::jsonb,

  status text not null default 'active'
    check (status in ('active', 'ended_pending_check', 'sold_candidate', 'unsold', 'ambiguous', 'inaccessible', 'review_complete')),

  -- Only ever populated from an explicit completed-sale signal carrying a
  -- usable price and date. A bid count, an end timestamp or a missing page
  -- must never reach these columns.
  sold_price numeric,
  sold_currency text,
  sold_at timestamptz,
  outcome_reason text,
  outcome_provider text,

  check_attempts integer not null default 0,
  next_check_at timestamptz,
  last_checked_at timestamptz,
  last_error text,

  -- Set only by a human confirming the sale. The link is what stops the same
  -- listing producing two sales.
  resulting_observation_id uuid references public.price_observations(id) on delete set null,
  reviewed_by text,
  reviewed_at timestamptz,
  review_notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A sold candidate without a price or a date is a contradiction: those are
  -- the two things that make it a candidate at all.
  constraint listing_outcomes_sold_candidate_needs_evidence check (
    status <> 'sold_candidate' or (sold_price is not null and sold_currency is not null and sold_at is not null)
  ),
  constraint listing_outcomes_price_positive check (sold_price is null or sold_price > 0)
);

-- One row per real listing per marketplace. This is the deduplication the
-- pipeline depends on -- a listing seen by three search profiles is still one
-- listing with one outcome.
create unique index if not exists listing_outcomes_marketplace_listing_unique
  on public.listing_outcomes (marketplace, external_id);

-- The scheduler's only query: what is due to be checked right now.
create index if not exists listing_outcomes_due_idx
  on public.listing_outcomes (next_check_at)
  where status in ('active', 'ended_pending_check', 'ambiguous');

create index if not exists listing_outcomes_status_idx on public.listing_outcomes (status, scheduled_end_at);
create index if not exists listing_outcomes_edition_idx on public.listing_outcomes (edition_id, status);
create index if not exists listing_outcomes_profile_idx on public.listing_outcomes (profile_id);
-- One listing may only ever produce one sale.
create unique index if not exists listing_outcomes_observation_unique
  on public.listing_outcomes (resulting_observation_id)
  where resulting_observation_id is not null;

alter table public.listing_outcomes enable row level security;

-- Every check attempt, including the failures. A classification nobody can
-- audit is a classification nobody should trust, and the failures are what
-- show whether eBay access is degraded.
create table if not exists public.listing_outcome_checks (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references public.listing_outcomes(id) on delete cascade,
  provider text not null,
  attempt_number integer not null,
  http_status integer,
  listing_state text,
  resulting_status text,
  detail text,
  raw_response jsonb,
  checked_at timestamptz not null default now()
);

create index if not exists listing_outcome_checks_outcome_idx
  on public.listing_outcome_checks (outcome_id, checked_at desc);

alter table public.listing_outcome_checks enable row level security;

comment on table public.listing_outcomes is
  'Listings Scout saw live, revisited after they end. A row here is never evidence: only a human confirming a sold candidate creates a price observation, and resulting_observation_id records that it happened.';
comment on column public.listing_outcomes.status is
  'active, ended_pending_check, sold_candidate, unsold, ambiguous, inaccessible, review_complete. sold_candidate requires an explicit completed-sale signal with a usable price and date; a bid count, an end time or a removed page never qualifies.';
comment on table public.listing_outcome_checks is
  'Every outcome check attempted, including errors, so a classification can be audited and a degraded eBay integration is visible rather than silent.';
