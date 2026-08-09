-- Fix a real bug in reject_reserved_collector_username() (from
-- 20260811_collector_usernames.sql): Postgres computes generated columns
-- AFTER "before insert" triggers run, not before -- so new.username_key
-- was still null at the point this function read it, and the reserved-word
-- check silently never fired (confirmed live: 'admin' was insertable).
-- Compares lower(new.username) directly instead. No table, policy, or
-- constraint changes -- only this function's body.
create or replace function public.reject_reserved_collector_username()
returns trigger
language plpgsql
as $$
begin
  if lower(new.username) = any (array[
    'admin','administrator','staff','support','help','about','contact',
    'null','undefined','root','rar','index','www','home','login','logout',
    'signin','signup','sign-in','sign-up','settings','setting','profile','profiles',
    'user','users','moderator','mod','system','security','terms','privacy',
    'legal','api','me','you','collector','collectors',
    'add-sale','browse','catalogue-import','catalogue-requests',
    'catalogue-review','collection-profiles','community-reports','cover-review',
    'coverage-dashboard','data-readiness','edition','identify','portfolio',
    'price-import','request-edition','review','scout','staff-login'
  ]) then
    raise exception 'This username is reserved and cannot be used.';
  end if;
  return new;
end;
$$;
