-- Community reports are evidence leads, never automatic price changes.
create table if not exists public.community_sale_reports (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.manga_editions(id) on delete cascade,
  report_type text not null check (report_type in ('sale', 'pricing_issue', 'edition_issue')),
  source_listing_url text not null,
  listing_title text,
  reported_price numeric(12, 2),
  currency text,
  sold_date date,
  reporter_notes text not null check (length(trim(reporter_notes)) >= 20),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'rejected', 'converted')),
  staff_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint community_sale_reports_currency_check check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint community_sale_reports_price_check check (reported_price is null or reported_price > 0)
);

alter table public.community_sale_reports enable row level security;

create index if not exists community_sale_reports_pending_idx
  on public.community_sale_reports(status, created_at desc);

create index if not exists community_sale_reports_edition_idx
  on public.community_sale_reports(edition_id, created_at desc);
