-- Pause the one Market Scout search profile still flagged as low-yield.
--
-- On 16 Nov the agent reported 4 low-yield profiles; by 28 Nov three had
-- recovered and only this one remained. Its 10 open leads on 28 Nov:
--   * 6 were "[CHOOSE PART]" / generic multi-part listings with no volume,
--   * 2 scored as plausible only because "Part 5" (Golden Wind) was read as
--     "Vol. 5"; this edition is VIZ's 2006 JoJo's Bizarre Adventure Vol. 5
--     (ISBN 9781421506548), so neither is this book,
--   * 2 were other generic JoJo listings.
-- None was this edition.
--
-- Uses the audited profile editor, so a revision row records the previous
-- query, notes, interval and active flag. Reversible: set is_active back to
-- true through the same function. Leads already collected are untouched.
do $$
declare
  p public.marketplace_search_profiles;
begin
  select * into p from public.marketplace_search_profiles
  where id = '0327c88a-2704-40fa-89ff-6adad786feb2' and is_active;
  if not found then
    raise notice 'Profile already inactive or missing; nothing to do.';
    return;
  end if;
  perform public.update_marketplace_search_profile(
    p.id,
    p.search_query,
    -- The editor needs a 20-character scope note; older profiles may have none.
    case when length(trim(coalesce(p.scope_notes, ''))) >= 20 then p.scope_notes
      else trim(coalesce(p.scope_notes, '') || ' Paused 28 Nov 2026 as low-yield.') end,
    p.collection_interval_days,
    false,
    'RAR staff (owner-approved 28 Nov 2026)',
    'Paused as low-yield: 0 of 10 open leads were this edition (28 Nov 2026).'
  );
end $$;
