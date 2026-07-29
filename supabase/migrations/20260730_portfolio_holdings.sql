-- A private portfolio can contain only RAR edition records. Cost fields are
-- optional because owning an item and knowing its purchase history are distinct.
create table if not exists public.portfolio_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  edition_id uuid not null references public.manga_editions(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  purchase_price numeric check (purchase_price is null or purchase_price >= 0),
  purchase_currency text check (purchase_currency is null or purchase_currency ~ '^[A-Z]{3}$'),
  purchase_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, edition_id),
  check (purchase_price is null or purchase_currency is not null)
);

create index if not exists portfolio_holdings_user_created_idx
  on public.portfolio_holdings(user_id, created_at desc);

alter table public.portfolio_holdings enable row level security;

create policy "Users can read their own portfolio holdings"
  on public.portfolio_holdings for select
  using (auth.uid() = user_id);

create policy "Users can add their own portfolio holdings"
  on public.portfolio_holdings for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own portfolio holdings"
  on public.portfolio_holdings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own portfolio holdings"
  on public.portfolio_holdings for delete
  using (auth.uid() = user_id);
