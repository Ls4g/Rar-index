-- Brute-force protection for staff sign-in.
--
-- Until now an attacker could guess the single shared staff credential as fast
-- as the network allowed, through either of two doors: POST /api/staff-session,
-- and an Authorization: Basic header on any staff page, which proxy.ts accepts
-- directly. Neither counted attempts. The password is long enough that guessing
-- was never realistic, but nothing stopped anyone trying forever.
--
-- Shaped after register_catalogue_request_submission in
-- 20260730_collector_research_foundations.sql: one atomic SECURITY DEFINER
-- function, a row lock so two concurrent attempts cannot both slip through, and
-- a hashed fingerprint so a raw IP address is never stored.

create table if not exists public.staff_login_rate_limits (
  -- SHA-256 of the client address. Never the address itself: this table exists
  -- to count attempts, not to build a log of who visited.
  fingerprint text primary key,
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  updated_at timestamptz not null default now()
);

alter table public.staff_login_rate_limits enable row level security;
revoke all on public.staff_login_rate_limits from public, anon, authenticated;

create index if not exists staff_login_rate_limits_window_idx
  on public.staff_login_rate_limits (window_started_at);

-- Count one sign-in attempt and say whether it may proceed.
--
-- Called BEFORE the credentials are checked, so a flood of guesses is stopped
-- without the password ever being compared. Ten attempts in fifteen minutes is
-- comfortably more than a person who mistypes with caps lock on, and useless to
-- a bot.
--
-- Deliberately per-fingerprint only. A global ceiling would let anyone lock the
-- owner out of their own admin by firing requests from anywhere -- a worse
-- outcome than the guessing it would prevent.
create or replace function public.claim_staff_login_attempt(p_fingerprint text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  limiter public.staff_login_rate_limits%rowtype;
  max_attempts constant integer := 10;
  window_length constant interval := interval '15 minutes';
begin
  if length(trim(coalesce(p_fingerprint, ''))) < 32 then
    raise exception 'Invalid login fingerprint';
  end if;

  select * into limiter
  from public.staff_login_rate_limits
  where fingerprint = p_fingerprint
  for update;

  if not found then
    insert into public.staff_login_rate_limits (fingerprint) values (p_fingerprint);
    return jsonb_build_object('allowed', true, 'remaining', max_attempts - 1, 'retry_after_seconds', 0);
  end if;

  -- A lapsed window starts over rather than decaying, which keeps the function
  -- cheap and the behaviour easy to describe.
  if limiter.window_started_at < now() - window_length then
    update public.staff_login_rate_limits
    set window_started_at = now(), attempt_count = 1, updated_at = now()
    where fingerprint = p_fingerprint;
    return jsonb_build_object('allowed', true, 'remaining', max_attempts - 1, 'retry_after_seconds', 0);
  end if;

  if limiter.attempt_count >= max_attempts then
    return jsonb_build_object(
      'allowed', false,
      'remaining', 0,
      'retry_after_seconds', greatest(1, ceil(extract(epoch from (limiter.window_started_at + window_length - now())))::integer)
    );
  end if;

  update public.staff_login_rate_limits
  set attempt_count = attempt_count + 1, updated_at = now()
  where fingerprint = p_fingerprint;
  return jsonb_build_object('allowed', true, 'remaining', max_attempts - limiter.attempt_count - 1, 'retry_after_seconds', 0);
end;
$$;

-- A correct sign-in clears the count, so the limit only ever accumulates
-- against someone who keeps getting it wrong.
create or replace function public.clear_staff_login_attempts(p_fingerprint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.staff_login_rate_limits where fingerprint = p_fingerprint;
end;
$$;

revoke all on function public.claim_staff_login_attempt(text) from public, anon, authenticated;
revoke all on function public.clear_staff_login_attempts(text) from public, anon, authenticated;
