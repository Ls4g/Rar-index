-- Historical display conversion. Source amounts in price_observations are never
-- changed; this table stores the ECB reference rate that applied on the sale date.
create table if not exists public.exchange_rates (
  rate_date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  rate_per_eur numeric(18,8) not null check (rate_per_eur > 0),
  source_name text not null default 'European Central Bank',
  source_series text not null,
  source_url text not null,
  retrieved_at timestamptz not null default now(),
  primary key (rate_date, currency)
);

alter table public.exchange_rates enable row level security;

drop policy if exists "Public can read exchange rates" on public.exchange_rates;
create policy "Public can read exchange rates"
  on public.exchange_rates for select using (true);

-- ECB publishes weekday reference rates. The 7 June sale falls back to the
-- immediately preceding published business-day rate (5 June) in the app.
insert into public.exchange_rates (rate_date, currency, rate_per_eur, source_series, source_url) values
  ('2026-05-05', 'USD', 1.16860000, 'EXR.D.USD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  ('2026-05-05', 'GBP', 0.86343000, 'EXR.D.GBP.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP.EUR.SP00.A'),
  ('2026-05-05', 'CAD', 1.59100000, 'EXR.D.CAD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A'),
  ('2026-05-25', 'USD', 1.16430000, 'EXR.D.USD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  ('2026-05-25', 'GBP', 0.86255000, 'EXR.D.GBP.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP.EUR.SP00.A'),
  ('2026-05-25', 'CAD', 1.60820000, 'EXR.D.CAD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A'),
  ('2026-05-29', 'USD', 1.16440000, 'EXR.D.USD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  ('2026-05-29', 'GBP', 0.86723000, 'EXR.D.GBP.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP.EUR.SP00.A'),
  ('2026-05-29', 'CAD', 1.60740000, 'EXR.D.CAD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A'),
  ('2026-06-05', 'USD', 1.16400000, 'EXR.D.USD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  ('2026-06-05', 'GBP', 0.86433000, 'EXR.D.GBP.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP.EUR.SP00.A'),
  ('2026-06-05', 'CAD', 1.61590000, 'EXR.D.CAD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A'),
  ('2026-06-25', 'USD', 1.13420000, 'EXR.D.USD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  ('2026-06-25', 'GBP', 0.86183000, 'EXR.D.GBP.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP.EUR.SP00.A'),
  ('2026-06-25', 'CAD', 1.61510000, 'EXR.D.CAD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A'),
  ('2026-07-17', 'USD', 1.14350000, 'EXR.D.USD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  ('2026-07-17', 'GBP', 0.85098000, 'EXR.D.GBP.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP.EUR.SP00.A'),
  ('2026-07-17', 'CAD', 1.60350000, 'EXR.D.CAD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A'),
  ('2026-07-22', 'USD', 1.14080000, 'EXR.D.USD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A'),
  ('2026-07-22', 'GBP', 0.85340000, 'EXR.D.GBP.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.GBP.EUR.SP00.A'),
  ('2026-07-22', 'CAD', 1.60710000, 'EXR.D.CAD.EUR.SP00.A', 'https://data-api.ecb.europa.eu/service/data/EXR/D.CAD.EUR.SP00.A')
on conflict (rate_date, currency) do update set
  rate_per_eur = excluded.rate_per_eur,
  source_name = excluded.source_name,
  source_series = excluded.source_series,
  source_url = excluded.source_url,
  retrieved_at = now();
