-- A paid sold-listing search is claimed by ISBN before Apify is called.
-- This records empty and failed searches too, unlike listing_outcomes, and
-- makes simultaneous clicks from separate tabs contend on one database row.
create table if not exists public.price_coverage_search_cooldowns (
  isbn_13 text primary key check (isbn_13 ~ '^[0-9]{13}$'),
  requested_edition_id uuid references public.manga_editions(id) on delete set null,
  last_started_at timestamptz not null default now(),
  last_finished_at timestamptz,
  last_status text not null default 'running'
    check (last_status in ('running', 'succeeded', 'failed')),
  last_result_count integer check (last_result_count is null or last_result_count >= 0),
  last_error text
);

alter table public.price_coverage_search_cooldowns enable row level security;

comment on table public.price_coverage_search_cooldowns is
  'Cost guard for staff-triggered Apify ISBN searches. This is a search log, not sale evidence.';

-- The conflict update is atomic: only one of two concurrent callers can pass
-- the timestamp condition. A failed or empty search still uses its cooldown,
-- since Apify may have charged for that run.
create or replace function public.claim_price_coverage_search(
  p_isbn_13 text,
  p_edition_id uuid,
  p_cooldown_hours integer default 12
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_claimed text;
  v_hours integer := greatest(1, least(coalesce(p_cooldown_hours, 12), 168));
begin
  insert into public.price_coverage_search_cooldowns (
    isbn_13, requested_edition_id, last_started_at, last_status
  ) values (
    p_isbn_13, p_edition_id, now(), 'running'
  )
  on conflict (isbn_13) do update
    set requested_edition_id = excluded.requested_edition_id,
        last_started_at = excluded.last_started_at,
        last_finished_at = null,
        last_status = 'running',
        last_result_count = null,
        last_error = null
    where price_coverage_search_cooldowns.last_started_at
      <= now() - make_interval(hours => v_hours)
  returning isbn_13 into v_claimed;

  return v_claimed is not null;
end;
$$;

revoke all on function public.claim_price_coverage_search(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_price_coverage_search(text, uuid, integer)
  to service_role;
