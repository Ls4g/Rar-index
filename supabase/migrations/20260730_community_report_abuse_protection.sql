-- Public reports are evidence leads; throttle anonymous submissions without storing raw IP addresses.
create table if not exists public.community_report_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  submission_count integer not null default 1 check (submission_count >= 1),
  updated_at timestamptz not null default now()
);

alter table public.community_report_rate_limits enable row level security;

-- A URL may only be suggested once for a given edition. The API performs the
-- friendly duplicate check; this index also closes the race between requests.
create unique index if not exists community_sale_reports_edition_source_unique
  on public.community_sale_reports (edition_id, source_listing_url);

create or replace function public.register_community_report_submission(p_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  limiter public.community_report_rate_limits%rowtype;
begin
  if length(trim(coalesce(p_fingerprint, ''))) < 32 then
    raise exception 'Invalid report fingerprint';
  end if;

  select * into limiter
  from public.community_report_rate_limits
  where fingerprint = p_fingerprint
  for update;

  if not found then
    insert into public.community_report_rate_limits (fingerprint) values (p_fingerprint);
    return true;
  end if;

  if limiter.window_started_at < now() - interval '1 hour' then
    update public.community_report_rate_limits
    set window_started_at = now(), submission_count = 1, updated_at = now()
    where fingerprint = p_fingerprint;
    return true;
  end if;

  if limiter.submission_count >= 5 then
    return false;
  end if;

  update public.community_report_rate_limits
  set submission_count = submission_count + 1, updated_at = now()
  where fingerprint = p_fingerprint;
  return true;
end;
$$;

revoke all on function public.register_community_report_submission(text) from public;
