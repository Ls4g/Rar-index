insert into public.sources (name, base_url, source_type, trust_tier, is_active)
select 'OpenBD', 'https://openbd.jp', 'catalog', 1, true
where not exists (
  select 1
  from public.sources
  where name = 'OpenBD'
);
