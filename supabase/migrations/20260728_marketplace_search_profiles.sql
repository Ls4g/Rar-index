-- A search profile records how RAR should look for completed sales of one
-- exact edition on one marketplace. It is a collection specification only:
-- no profile can create or verify a price observation by itself.
create table if not exists public.marketplace_search_profiles (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.manga_editions(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete restrict,
  search_query text not null check (length(trim(search_query)) > 0),
  scope_notes text not null default '',
  is_active boolean not null default true,
  last_checked_at timestamptz,
  last_checked_result_count integer check (last_checked_result_count is null or last_checked_result_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, source_id, search_query)
);

create index if not exists marketplace_search_profiles_active_edition_idx
  on public.marketplace_search_profiles(edition_id)
  where is_active = true;

alter table public.marketplace_search_profiles enable row level security;

-- Seed the first profile with the exact edition identifiers already verified
-- from its copyright-page evidence. This is not a price import.
insert into public.marketplace_search_profiles (
  edition_id,
  source_id,
  search_query,
  scope_notes
)
select
  edition.id,
  source.id,
  '"9784088725093" "ONE PIECE" 1997 first print',
  'Completed listings only. Match Japanese One Piece 1, ISBN 9784088725093, issued 29 December 1997, first printing. Exclude ended listings, later printings, gold-foil variants, and graded copies from the raw-sale workflow.'
from public.manga_editions edition
join public.sources source on source.name = 'eBay Sold'
where edition.id = 'f85e616c-7aa8-4806-8c18-2af0d5aa78be'::uuid
on conflict (edition_id, source_id, search_query) do nothing;
