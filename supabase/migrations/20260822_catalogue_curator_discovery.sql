-- Catalogue Curator discovery phase.
--
-- The application may now search approved bibliographic sources and stage
-- publication candidates in catalogue_import_queue. It still has no path to
-- approve a candidate, publish an edition, or verify a cover.

update public.agent_controls
set mode = 'prepare',
    mission = 'Discover ISBN-backed manga publication candidates from approved bibliographic sources, then leave every result for human catalogue review.',
    schedule_label = 'Daily candidate discovery',
    updated_by = 'RAR autonomy migration'
where agent_key = 'catalogue_curator';

comment on table public.catalogue_import_queue is
  'Human review queue shared by manual imports and Catalogue Curator discovery. A queued candidate is never a verified edition.';
