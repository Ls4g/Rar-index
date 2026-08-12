-- A shelf a collector can choose to show other people.
--
-- r/MangaCollectors (1.93M members) posts photographs of its shelves as its
-- primary activity -- display is the single most-discussed topic there. RAR
-- already holds what people own; it just has nowhere to show it. This adds
-- that, opt-in and minimal.
--
-- The privacy line is the whole design:
--   * Off by default. shelf_is_public is false until the owner turns it on.
--   * The view exposes the username and which editions are on the shelf.
--     Nothing else. Not purchase_price, not purchase_currency, not
--     purchase_date, not notes, not quantity, not user_id, not the auth
--     email. Those columns are never selected, so no future policy change
--     can leak them through this path.
--   * portfolio_holdings keeps every existing RLS policy untouched. A
--     signed-in user still reads only their own rows through the table.
--
-- Purely additive: one nullable-defaulted column and one view.

alter table public.collector_profiles
  add column if not exists shelf_is_public boolean not null default false;

comment on column public.collector_profiles.shelf_is_public is
  'Owner opt-in. When false (the default) the collector has no public shelf and public_shelf_editions returns nothing for them.';

-- security_invoker = false deliberately: the point is to let an anonymous
-- visitor read a shelf its owner has published, which RLS on
-- portfolio_holdings would otherwise (correctly) prevent. The where clause
-- below is what makes that safe -- only opted-in owners appear at all.
create or replace view public.public_shelf_editions
with (security_invoker = false) as
  select
    profile.username,
    profile.username_key,
    holding.edition_id
  from public.portfolio_holdings holding
  join public.collector_profiles profile on profile.user_id = holding.user_id
  where profile.shelf_is_public;

comment on view public.public_shelf_editions is
  'Which editions sit on a published collector shelf. Deliberately carries no purchase price, date, note, quantity or user id -- only a handle and an edition.';

grant select on public.public_shelf_editions to anon, authenticated;
