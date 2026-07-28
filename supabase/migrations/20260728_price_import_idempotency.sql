-- Marketplace CSV imports are append-only candidates. A listing can appear only once per source.
-- PostgreSQL still permits multiple NULL external IDs; the CSV preflight requires a non-empty ID.
create unique index if not exists price_observations_source_external_id_unique
  on public.price_observations(source_id, external_id);
