-- Reserve a daily paid-search slot and the ISBN cooldown in one transaction.
-- Failed/empty runs retain their slot because Apify may still charge for them.
create table if not exists public.apify_daily_search_usage (
  search_day date primary key,
  claimed_searches integer not null default 0 check (claimed_searches >= 0),
  updated_at timestamptz not null default now()
);

alter table public.apify_daily_search_usage enable row level security;

comment on table public.apify_daily_search_usage is
  'UTC daily count of metered scheduled Apify searches; never sale evidence.';

create or replace function public.claim_scheduled_apify_search(
  p_isbn_13 text,
  p_edition_id uuid,
  p_daily_limit integer,
  p_cooldown_hours integer default 12
)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_used integer;
begin
  if p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 10 then
    return 'daily_limit';
  end if;

  insert into public.apify_daily_search_usage (search_day) values (v_day)
    on conflict (search_day) do nothing;
  select claimed_searches into v_used
    from public.apify_daily_search_usage where search_day = v_day for update;
  if v_used >= p_daily_limit then return 'daily_limit'; end if;

  if not public.claim_price_coverage_search(p_isbn_13, p_edition_id, p_cooldown_hours) then
    return 'cooldown';
  end if;

  update public.apify_daily_search_usage
    set claimed_searches = claimed_searches + 1, updated_at = now()
    where search_day = v_day;
  return 'claimed';
end;
$$;

revoke all on function public.claim_scheduled_apify_search(text, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_scheduled_apify_search(text, uuid, integer, integer)
  to service_role;
