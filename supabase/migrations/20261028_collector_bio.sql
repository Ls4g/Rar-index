-- A short, optional introduction written by the collector for their public profile.
begin;

alter table public.collector_profiles
  add column if not exists bio text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'collector_profiles_bio_length'
  ) then
    alter table public.collector_profiles
      add constraint collector_profiles_bio_length
      check (bio is null or char_length(bio) <= 160);
  end if;
end $$;

commit;
