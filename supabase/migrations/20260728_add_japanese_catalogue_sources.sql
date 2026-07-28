-- Official publisher and national-bibliography sources for Japanese manga.
-- Kept idempotent so this can safely be applied once in Supabase.
insert into public.sources (name, base_url, source_type, trust_tier, is_active)
select 'Shueisha Direct', 'https://books.shueisha.co.jp', 'publisher', 1, true
where not exists (select 1 from public.sources where name = 'Shueisha Direct');

insert into public.sources (name, base_url, source_type, trust_tier, is_active)
select 'National Diet Library Search', 'https://ndlsearch.ndl.go.jp', 'catalog', 1, true
where not exists (select 1 from public.sources where name = 'National Diet Library Search');
