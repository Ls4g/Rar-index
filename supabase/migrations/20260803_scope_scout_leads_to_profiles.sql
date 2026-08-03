-- A listing may appear in more than one exact-edition search. Keep that
-- evidence attached to every relevant profile instead of moving it between
-- editions on each later scan.
alter table public.scout_listing_leads
  drop constraint if exists scout_listing_leads_source_id_external_id_key;

alter table public.scout_listing_leads
  add constraint scout_listing_leads_profile_source_external_key
  unique (profile_id, source_id, external_id);
