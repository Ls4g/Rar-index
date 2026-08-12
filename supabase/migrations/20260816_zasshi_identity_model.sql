-- Roadmap item 6, step 1: give RAR an identity model for Japanese magazines.
-- Design and evidence: docs/zasshi-model.md
--
-- manga_editions treats isbn_13 as the duplicate guard and the strongest
-- matching signal. Japanese magazines carry no ISBN, so this adds the
-- identity that replaces it: the magazine title, the year and printed issue
-- label, and 通巻 (the running count since the magazine's first issue), which
-- is the only one of the three numbers on a Japanese magazine that uniquely
-- identifies an issue.
--
-- Additive throughout. No existing column or row is altered; all 78 current
-- catalogue rows are tankobon and are untouched by every constraint below.

-- 1. Magazine titles ---------------------------------------------------------
-- A magazine title is neither a series nor an edition. It needs its own
-- identity because the zasshi code, the run dates, and the 増刊 (supplement)
-- versus 本誌 (main magazine) distinction all live at title level rather than
-- issue level.
create table if not exists public.magazine_titles (
  id uuid primary key default gen_random_uuid(),
  name_ja text not null,
  name_romaji text,
  publisher text not null,
  -- Five digits on the back cover. Identifies the TITLE, not the issue, and
  -- is periodically reissued (Weekly Shonen Jump moved 29932 -> 29933), so it
  -- is an attribute here and never a key.
  zasshi_code text,
  madb_id text unique,
  -- V Jump began as Vジャンプ（週刊少年ジャンプ特別編集増刊）and later separated.
  -- MADB models supplements as distinct magazines and so must RAR: collapsing
  -- them into their parent recreates the One Piece duplicate bug in a new
  -- place. Null once a supplement has become independent.
  parent_title_id uuid references public.magazine_titles(id),
  title_kind text not null default 'main'
    check (title_kind in ('main', 'supplement', 'special_edition')),
  first_issued_on date,
  final_issued_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint magazine_titles_run_dates_check
    check (final_issued_on is null or first_issued_on is null or final_issued_on >= first_issued_on),
  constraint magazine_titles_not_own_parent_check
    check (parent_title_id is null or parent_title_id <> id)
);

create unique index if not exists magazine_titles_name_publisher_unique
  on public.magazine_titles (name_ja, publisher);

create index if not exists magazine_titles_parent_idx
  on public.magazine_titles (parent_title_id);

alter table public.magazine_titles enable row level security;

-- Catalogue data, public like manga_editions itself. Writes stay with the
-- service role, which is how staff review reaches every other catalogue table.
drop policy if exists magazine_titles_public_read on public.magazine_titles;
create policy magazine_titles_public_read
  on public.magazine_titles for select
  using (true);

-- 2. Issue identity on manga_editions ----------------------------------------
-- collectible_type already permits 'zasshi' (20260730_collector_research_
-- foundations.sql) but nothing has ever used it and no supporting columns
-- existed. These are those columns.
alter table public.manga_editions
  add column if not exists magazine_title_id uuid references public.magazine_titles(id),
  -- 1997
  add column if not exists issue_year smallint,
  -- as printed on the cover: '34', and '4・5' for a 合併号 (combined issue)
  add column if not exists issue_number_label text,
  -- 通巻 1458. Monotonic for the magazine's whole life, unaffected by the year
  -- resetting, and unbroken by combined issues -- the actual key.
  add column if not exists cumulative_issue_no integer,
  add column if not exists madb_id text;

-- volume_number keeps its display role and holds '1997年34号'. Identity lives
-- in the structured columns above.

create index if not exists manga_editions_magazine_title_idx
  on public.manga_editions (magazine_title_id, cumulative_issue_no)
  where collectible_type = 'zasshi';

create index if not exists manga_editions_madb_idx
  on public.manga_editions (madb_id)
  where madb_id is not null;

-- Identity is mandatory for a magazine issue and forbidden for anything else.
-- Enforced at table level rather than only in apply_catalogue_review, so a
-- direct insert or a future import path cannot route around it.
alter table public.manga_editions
  drop constraint if exists manga_editions_zasshi_identity_check;
alter table public.manga_editions
  add constraint manga_editions_zasshi_identity_check check (
    case when collectible_type = 'zasshi'
      then magazine_title_id is not null
        and issue_year is not null
        and issue_number_label is not null
        and length(trim(issue_number_label)) > 0
      else magazine_title_id is null
        and issue_year is null
        and issue_number_label is null
        and cumulative_issue_no is null
    end
  );

alter table public.manga_editions
  drop constraint if exists manga_editions_issue_year_range_check;
alter table public.manga_editions
  add constraint manga_editions_issue_year_range_check check (
    issue_year is null or issue_year between 1874 and 2100
  );

alter table public.manga_editions
  drop constraint if exists manga_editions_cumulative_issue_positive_check;
alter table public.manga_editions
  add constraint manga_editions_cumulative_issue_positive_check check (
    cumulative_issue_no is null or cumulative_issue_no > 0
  );

-- 3. Duplicate protection ----------------------------------------------------
-- Two partial indexes, both scoped to publication-level zasshi records so a
-- print-run child (printing_of_edition_id set) may legitimately repeat its
-- parent's identity, exactly as the tankobon model allows. Neither touches a
-- tankobon row.
create unique index if not exists manga_editions_zasshi_cumulative_unique
  on public.manga_editions (magazine_title_id, cumulative_issue_no)
  where collectible_type = 'zasshi'
    and printing_of_edition_id is null
    and cumulative_issue_no is not null;

create unique index if not exists manga_editions_zasshi_issue_label_unique
  on public.manga_editions (magazine_title_id, issue_year, issue_number_label)
  where collectible_type = 'zasshi'
    and printing_of_edition_id is null;

-- 4. Close the review hole ---------------------------------------------------
-- apply_catalogue_review blocked duplicates by ISBN alone. A zasshi candidate
-- has no ISBN, so that branch never fires and magazines would have shipped
-- with no duplicate protection whatsoever -- the precise condition that
-- produced the One Piece and Hunter x Hunter duplicate pairs for books.
--
-- Replaced in place (same six-argument signature, no new overload -- see
-- 20260814_drop_stale_catalogue_review_overload.sql for why a stale overload
-- is a hazard). Reproduces the 2026-08-14 definition with optional notes and
-- the duplicate-ISBN printing guard intact, and adds the zasshi branch.
create or replace function public.apply_catalogue_review(
  p_catalogue_import_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text,
  p_existing_edition_id uuid default null,
  p_metadata jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  imported public.catalogue_import_queue%rowtype;
  resulting_edition_id uuid;
  resulting_status text;
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
  approved_title text;
  approved_series text;
  approved_volume_number text;
  approved_author text;
  approved_publisher text;
  approved_language text;
  approved_isbn_13 text;
  approved_release_date date;
  approved_printing_of_edition_id uuid;
  approved_collectible_type text;
  approved_magazine_title_id uuid;
  approved_issue_year smallint;
  approved_issue_number_label text;
  approved_cumulative_issue_no integer;
  approved_madb_id text;
  clashing_edition_id uuid;
begin
  if p_decision not in ('approve_new', 'link_existing', 'needs_review', 'rejected', 'duplicate') then
    raise exception 'Invalid catalogue review decision';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Reviewer is required';
  end if;

  select * into imported
  from public.catalogue_import_queue
  where id = p_catalogue_import_id
  for update;

  if not found then
    raise exception 'Catalogue import % does not exist', p_catalogue_import_id;
  end if;

  if p_decision = 'approve_new' then
    if imported.candidate_kind <> 'edition_candidate' then
      raise exception 'A series reference cannot create a physical edition without edition-level evidence';
    end if;

    approved_title := coalesce(nullif(trim(p_metadata ->> 'title'), ''), imported.candidate_title);
    approved_series := coalesce(nullif(trim(p_metadata ->> 'series'), ''), imported.candidate_series);
    approved_volume_number := coalesce(nullif(trim(p_metadata ->> 'volume_number'), ''), imported.candidate_volume_number);
    approved_author := coalesce(nullif(trim(p_metadata ->> 'author'), ''), imported.candidate_author);
    approved_publisher := coalesce(nullif(trim(p_metadata ->> 'publisher'), ''), imported.candidate_publisher);
    approved_language := coalesce(nullif(trim(p_metadata ->> 'language'), ''), imported.candidate_language);
    approved_isbn_13 := coalesce(nullif(trim(p_metadata ->> 'isbn_13'), ''), imported.candidate_isbn_13);
    approved_release_date := coalesce(nullif(trim(p_metadata ->> 'release_date'), '')::date, imported.candidate_release_date);
    approved_printing_of_edition_id := nullif(trim(p_metadata ->> 'printing_of_edition_id'), '')::uuid;
    approved_collectible_type := coalesce(nullif(trim(p_metadata ->> 'collectible_type'), ''), 'tankobon');
    approved_magazine_title_id := nullif(trim(p_metadata ->> 'magazine_title_id'), '')::uuid;
    approved_issue_year := nullif(trim(p_metadata ->> 'issue_year'), '')::smallint;
    approved_issue_number_label := nullif(trim(p_metadata ->> 'issue_number_label'), '');
    approved_cumulative_issue_no := nullif(trim(p_metadata ->> 'cumulative_issue_no'), '')::integer;
    approved_madb_id := nullif(trim(p_metadata ->> 'madb_id'), '');

    if approved_title is null or approved_language is null then
      raise exception 'Approval requires a title and language';
    end if;
    if approved_collectible_type not in ('tankobon', 'zasshi', 'convention_exclusive', 'promo_variant', 'graded') then
      raise exception 'Unknown collectible type %', approved_collectible_type;
    end if;
    if approved_isbn_13 is not null and approved_isbn_13 !~ '^97[89][0-9]{10}$' then
      raise exception 'ISBN-13 must contain 13 digits and begin 978 or 979';
    end if;

    if approved_isbn_13 is not null and exists (
      select 1 from public.manga_editions where isbn_13 = approved_isbn_13
    ) then
      if approved_printing_of_edition_id is null then
        raise exception 'ISBN % already exists in the catalogue. Use link_existing, or mark this candidate as a specific printing of the existing edition.', approved_isbn_13;
      end if;
      if not exists (
        select 1 from public.manga_editions
        where id = approved_printing_of_edition_id and isbn_13 = approved_isbn_13
      ) then
        raise exception 'The selected general edition does not carry ISBN %.', approved_isbn_13;
      end if;
    end if;

    if approved_collectible_type = 'zasshi' then
      -- A magazine issue without its identity is unmatchable and undedupable,
      -- so approval requires it rather than defaulting it.
      if approved_magazine_title_id is null then
        raise exception 'A magazine issue must name the magazine it belongs to (magazine_title_id).';
      end if;
      if not exists (select 1 from public.magazine_titles where id = approved_magazine_title_id) then
        raise exception 'Magazine title % does not exist', approved_magazine_title_id;
      end if;
      if approved_issue_year is null or approved_issue_number_label is null then
        raise exception 'A magazine issue requires its year and its printed issue number (issue_year, issue_number_label).';
      end if;

      -- Same shape as the ISBN branch above: an existing identity is only
      -- allowed through when the reviewer names the record it is a printing
      -- of, and that record must genuinely carry the same identity.
      select id into clashing_edition_id
      from public.manga_editions
      where collectible_type = 'zasshi'
        and printing_of_edition_id is null
        and magazine_title_id = approved_magazine_title_id
        and (
          (approved_cumulative_issue_no is not null and cumulative_issue_no = approved_cumulative_issue_no)
          or (issue_year = approved_issue_year and issue_number_label = approved_issue_number_label)
        )
      limit 1;

      if clashing_edition_id is not null then
        if approved_printing_of_edition_id is null then
          raise exception 'Issue %/% of that magazine is already catalogued. Use link_existing, or mark this candidate as a specific printing of the existing issue.',
            approved_issue_year, approved_issue_number_label;
        end if;
        if approved_printing_of_edition_id <> clashing_edition_id then
          raise exception 'The selected general edition is not issue %/% of that magazine.',
            approved_issue_year, approved_issue_number_label;
        end if;
      end if;
    else
      if approved_magazine_title_id is not null
        or approved_issue_year is not null
        or approved_issue_number_label is not null
        or approved_cumulative_issue_no is not null then
        raise exception 'Magazine issue fields are only valid on a zasshi record.';
      end if;
    end if;

    insert into public.manga_editions (
      title, series, volume_number, author, publisher, language, isbn_13,
      release_date, format, cover_image_url, is_verified, printing_of_edition_id,
      collectible_type, magazine_title_id, issue_year, issue_number_label,
      cumulative_issue_no, madb_id
    ) values (
      approved_title, approved_series, approved_volume_number,
      approved_author, approved_publisher, approved_language,
      approved_isbn_13, approved_release_date, imported.candidate_format,
      imported.candidate_cover_image_url, true, approved_printing_of_edition_id,
      approved_collectible_type, approved_magazine_title_id, approved_issue_year,
      approved_issue_number_label, approved_cumulative_issue_no, approved_madb_id
    ) returning id into resulting_edition_id;

    insert into public.edition_sources (
      edition_id, source_id, source_record_url, external_id, fields_verified,
      source_data, verification_notes, is_primary
    ) values (
      resulting_edition_id, imported.source_id, imported.source_record_url, imported.external_id,
      array_remove(array[
        'title',
        case when approved_language is not null then 'language' end,
        case when approved_isbn_13 is not null then 'isbn' end,
        case when approved_publisher is not null then 'publisher' end,
        case when approved_release_date is not null then 'release_date' end,
        case when approved_cumulative_issue_no is not null then 'cumulative_issue_no' end,
        case when approved_collectible_type = 'zasshi' then 'issue_number' end
      ], null),
      imported.raw_payload, v_notes, true
    );
    resulting_status := 'approved';
  elsif p_decision = 'link_existing' then
    if p_existing_edition_id is null then
      raise exception 'An existing edition is required when linking a catalogue import';
    end if;
    if not exists (select 1 from public.manga_editions where id = p_existing_edition_id) then
      raise exception 'Existing edition % does not exist', p_existing_edition_id;
    end if;

    resulting_edition_id := p_existing_edition_id;
    insert into public.edition_sources (
      edition_id, source_id, source_record_url, external_id, fields_verified,
      source_data, verification_notes, is_primary
    ) values (
      resulting_edition_id, imported.source_id, imported.source_record_url, imported.external_id,
      array['title'], imported.raw_payload, v_notes, false
    );
    resulting_status := 'linked';
  elsif p_decision = 'needs_review' then
    resulting_status := 'needs_review';
  elsif p_decision = 'duplicate' then
    resulting_status := 'duplicate';
  else
    resulting_status := 'rejected';
  end if;

  update public.catalogue_import_queue
  set status = resulting_status,
      matched_edition_id = resulting_edition_id,
      review_notes = v_notes,
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now(),
      updated_at = now()
  where id = p_catalogue_import_id;

  insert into public.catalogue_review_decisions (
    catalogue_import_id, decision, decision_notes, reviewed_by, resulting_edition_id
  ) values (
    p_catalogue_import_id, p_decision, v_notes, trim(p_reviewed_by), resulting_edition_id
  );

  return resulting_edition_id;
end;
$$;

revoke all on function public.apply_catalogue_review(uuid, text, text, text, uuid, jsonb) from public;

-- 5. Register the source -----------------------------------------------------
-- Japan's Media Arts Database, run by the National Center for Art Research.
-- Terms permit commercial use with attribution; cover images are excluded and
-- still come through cover_candidates. Trust tier 1 alongside the other
-- national-bibliography and publisher-direct sources.
insert into public.sources (name, base_url, source_type, trust_tier, is_active)
select 'Media Arts Database', 'https://mediaarts-db.artmuseums.go.jp', 'catalog', 1, true
where not exists (select 1 from public.sources where name = 'Media Arts Database');
