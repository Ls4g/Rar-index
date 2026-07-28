-- Publisher records are captured by exact URL and kept as evidence before review.
insert into public.sources (name, base_url, source_type, trust_tier, is_active)
values
  ('Kodansha Japan', 'https://www.kodansha.co.jp', 'publisher', 1, true),
  ('Kodansha USA', 'https://kodansha.us', 'publisher', 1, true),
  ('VIZ Media', 'https://www.viz.com', 'publisher', 1, true),
  ('TokyoPop Archive (Open Library)', 'https://openlibrary.org', 'catalog', 2, true)
on conflict (name) do nothing;
