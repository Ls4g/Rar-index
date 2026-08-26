-- Catalogue Curator: a persistent discovery backlog.
--
-- The curator previously planned its work from scratch on every run, from the
-- nine hard-coded names in lib/prioritySeries.ts, ordered by that list's own
-- index. One Piece is index 0, the run limit was four targets, so One Piece
-- took the run and the queue filled with One Piece volumes. It could not
-- discover a series nobody had already typed into that file.
--
-- This table is the memory that makes fair rotation and real discovery
-- possible: what RAR knows about, why it was chosen, what it has already
-- looked for, and when it is next worth looking again.
--
-- Additive. No existing table, row or workflow is touched, and nothing here
-- can publish an edition -- a target's whole life ends at
-- catalogue_import_queue, where a human still decides.

create table if not exists public.catalogue_discovery_targets (
  id uuid primary key default gen_random_uuid(),

  -- Stable work identity. AniList is the discovery source; its media id is
  -- stable, which is what lets a target be recognised across runs.
  discovery_source text not null default 'anilist',
  external_id text not null,

  title_english text,
  title_romaji text,
  title_native text,
  -- Normalised series name, used for deduplication and for the per-series cap
  -- in fair scheduling. Held rather than derived so the scheduler never has to
  -- re-normalise 500 rows to answer "how many slots has this series had".
  series_key text not null,

  -- Which lane found this. Permanent rather than a run-time classification:
  -- a title discovered as rising is still a rising discovery next month, and
  -- the lane is how staff understand why it is here.
  lane text not null check (lane in ('established', 'rising', 'new_release', 'series_gap')),
  language text check (language in ('English', 'Japanese')),

  -- Popularity, trending or relevance, depending on lane. A discovery signal
  -- only: it decides what RAR looks at, and never what RAR believes.
  score numeric,
  series_status text,

  -- Only ever populated when the source actually reports it. AniList returns
  -- null for every RELEASING series -- Kagurabachi, Hunter x Hunter and One
  -- Piece all come back null -- so this stays null for ongoing work and the
  -- next volume has to be proved bibliographically instead of assumed.
  reported_volume_count integer,
  next_missing_volume integer,

  status text not null default 'watching'
    check (status in ('watching', 'researchable', 'staged', 'published', 'blocked', 'caught_up')),

  source_url text,
  source_metadata jsonb not null default '{}'::jsonb,

  last_checked_at timestamptz,
  next_check_at timestamptz,
  -- Repeated empty searches back a target off rather than retrying it every
  -- run. An unreleased volume is the common case and must not burn a slot.
  failure_count integer not null default 0,
  last_result text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint catalogue_discovery_targets_volume_positive
    check (next_missing_volume is null or next_missing_volume > 0),
  constraint catalogue_discovery_targets_reported_volume_positive
    check (reported_volume_count is null or reported_volume_count > 0)
);

-- One row per work per language per volume. A gap target for volume 2 and one
-- for volume 3 are different targets; the same work in English and Japanese
-- are different targets; the same work rediscovered next week is not.
create unique index if not exists catalogue_discovery_targets_identity_unique
  on public.catalogue_discovery_targets
  (series_key, coalesce(language, ''), coalesce(next_missing_volume, 0));

-- The scheduler's query: what is researchable and due.
create index if not exists catalogue_discovery_targets_due_idx
  on public.catalogue_discovery_targets (next_check_at)
  where status in ('researchable', 'watching');

create index if not exists catalogue_discovery_targets_lane_idx on public.catalogue_discovery_targets (lane, status);
create index if not exists catalogue_discovery_targets_series_idx on public.catalogue_discovery_targets (series_key, status);
create index if not exists catalogue_discovery_targets_score_idx on public.catalogue_discovery_targets (score desc nulls last);
create index if not exists catalogue_discovery_targets_source_idx on public.catalogue_discovery_targets (discovery_source, external_id);

alter table public.catalogue_discovery_targets enable row level security;

comment on table public.catalogue_discovery_targets is
  'What the Catalogue Curator knows about and why. Discovery signals only -- a row here is never evidence of a physical edition, and the only route to the catalogue is catalogue_import_queue with a human decision at the end of it.';
comment on column public.catalogue_discovery_targets.score is
  'Popularity, trending or relevance depending on lane. Decides what RAR looks at, never what RAR believes.';
comment on column public.catalogue_discovery_targets.reported_volume_count is
  'Only when the source actually reports it. AniList returns null for ongoing series, so a missing volume is proved bibliographically rather than inferred from the preceding one existing.';
comment on column public.catalogue_discovery_targets.status is
  'watching (no physical volume yet), researchable (worth searching), staged (candidate queued for human review), published (already in the catalogue), blocked (repeatedly no exact record), caught_up (no known gap).';

-- Applied as a correction during the same session. PostgREST resolves
-- on_conflict by column name and cannot match an expression index, so the
-- coalesce() form above failed every upsert with "no unique or exclusion
-- constraint matching the ON CONFLICT specification". NULLS NOT DISTINCT keeps
-- the original intent -- one row per work per language per volume -- while
-- being addressable by name.
drop index if exists public.catalogue_discovery_targets_identity_unique;
create unique index if not exists catalogue_discovery_targets_identity_unique
  on public.catalogue_discovery_targets (series_key, language, next_missing_volume)
  nulls not distinct;
