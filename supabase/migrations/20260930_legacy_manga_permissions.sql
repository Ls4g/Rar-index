-- Legacy one-row table, not the live manga_editions catalogue. No application
-- consumer exists. Preserve its data; do not publish it through the Data API.
-- Checked live 2026-09-30: no existing RLS policies to preserve or replace.
begin;
alter table public.manga enable row level security;
revoke all on table public.manga from public, anon, authenticated;
grant all on table public.manga to service_role;
notify pgrst, 'reload schema';
commit;
