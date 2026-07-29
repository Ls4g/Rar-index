-- Collector research foundations: classify an item without guessing its value,
-- and let the public request missing records without publishing anything directly.
alter table public.manga_editions
  add column if not exists collectible_type text not null default 'tankobon'
  check (collectible_type in ('tankobon', 'zasshi', 'convention_exclusive', 'promo_variant', 'graded'));

create index if not exists manga_editions_collectible_type_idx
  on public.manga_editions (collectible_type);

create table if not exists public.catalogue_requests (
  id uuid primary key default gen_random_uuid(),
  requested_title text not null check (length(trim(requested_title)) between 2 and 300),
  series text,
  volume_number text,
  language text,
  publisher text,
  isbn_13 text,
  collectible_type text not null default 'tankobon'
    check (collectible_type in ('tankobon', 'zasshi', 'convention_exclusive', 'promo_variant', 'graded')),
  original_source_url text,
  copyright_evidence_url text,
  requester_notes text not null check (length(trim(requester_notes)) between 20 and 3000),
  status text not null default 'pending'
    check (status in ('pending', 'queued_for_research', 'declined', 'added_to_catalogue')),
  staff_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint catalogue_requests_isbn_format check (isbn_13 is null or isbn_13 ~ '^[0-9Xx -]{10,20}$')
);

alter table public.catalogue_requests enable row level security;

create index if not exists catalogue_requests_status_created_idx
  on public.catalogue_requests (status, created_at desc);

create table if not exists public.catalogue_request_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.catalogue_requests(id) on delete cascade,
  decision text not null check (decision in ('queued_for_research', 'declined', 'added_to_catalogue')),
  decision_notes text not null check (length(trim(decision_notes)) >= 12),
  reviewed_by text not null,
  created_at timestamptz not null default now()
);

alter table public.catalogue_request_decisions enable row level security;

create index if not exists catalogue_request_decisions_request_created_idx
  on public.catalogue_request_decisions (request_id, created_at desc);

create table if not exists public.catalogue_request_rate_limits (
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  submission_count integer not null default 1 check (submission_count >= 1),
  updated_at timestamptz not null default now()
);

alter table public.catalogue_request_rate_limits enable row level security;

create or replace function public.register_catalogue_request_submission(p_fingerprint text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  limiter public.catalogue_request_rate_limits%rowtype;
begin
  if length(trim(coalesce(p_fingerprint, ''))) < 32 then
    raise exception 'Invalid request fingerprint';
  end if;

  select * into limiter
  from public.catalogue_request_rate_limits
  where fingerprint = p_fingerprint
  for update;

  if not found then
    insert into public.catalogue_request_rate_limits (fingerprint) values (p_fingerprint);
    return true;
  end if;

  if limiter.window_started_at < now() - interval '1 hour' then
    update public.catalogue_request_rate_limits
    set window_started_at = now(), submission_count = 1, updated_at = now()
    where fingerprint = p_fingerprint;
    return true;
  end if;

  if limiter.submission_count >= 5 then
    return false;
  end if;

  update public.catalogue_request_rate_limits
  set submission_count = submission_count + 1, updated_at = now()
  where fingerprint = p_fingerprint;
  return true;
end;
$$;

create or replace function public.apply_catalogue_request_decision(
  p_request_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision not in ('queued_for_research', 'declined', 'added_to_catalogue') then
    raise exception 'Invalid catalogue request decision';
  end if;
  if length(trim(coalesce(p_decision_notes, ''))) < 12 then
    raise exception 'Decision notes must contain at least 12 characters';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Reviewer is required';
  end if;

  update public.catalogue_requests
  set status = p_decision,
      staff_notes = trim(p_decision_notes),
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now()
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'Catalogue request % is not pending or does not exist', p_request_id;
  end if;

  insert into public.catalogue_request_decisions (request_id, decision, decision_notes, reviewed_by)
  values (p_request_id, p_decision, trim(p_decision_notes), trim(p_reviewed_by));
end;
$$;

revoke all on function public.register_catalogue_request_submission(text) from public;
revoke all on function public.apply_catalogue_request_decision(uuid, text, text, text) from public;
