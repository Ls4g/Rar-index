-- Priority-1 root-cause fix: "Create verified edition" previously let a
-- reviewer approve a brand-new manga_editions row for an ISBN that already
-- belongs to an existing edition, with no warning. That is how the One
-- Piece and Hunter x Hunter Japanese Vol. 1 duplicate pairs were created.
--
-- This keeps the exact same function signature as the 2026-07-29 migration
-- (create or replace in place, no new overload) and adds one rule: approving
-- a candidate whose ISBN already exists now requires the reviewer to name
-- the existing edition it is a specific printing of, via
-- p_metadata->>'printing_of_edition_id'. Without it, approval fails with a
-- clear error instead of silently creating a duplicate.
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
  approved_title text;
  approved_series text;
  approved_volume_number text;
  approved_author text;
  approved_publisher text;
  approved_language text;
  approved_isbn_13 text;
  approved_release_date date;
  approved_printing_of_edition_id uuid;
begin
  if p_decision not in ('approve_new', 'link_existing', 'needs_review', 'rejected', 'duplicate') then
    raise exception 'Invalid catalogue review decision';
  end if;
  if length(trim(coalesce(p_decision_notes, ''))) < 12 then
    raise exception 'Review notes must contain at least 12 characters';
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

    if approved_title is null or approved_language is null then
      raise exception 'Approval requires a title and language';
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

    insert into public.manga_editions (
      title, series, volume_number, author, publisher, language, isbn_13,
      release_date, format, cover_image_url, is_verified, printing_of_edition_id
    ) values (
      approved_title, approved_series, approved_volume_number,
      approved_author, approved_publisher, approved_language,
      approved_isbn_13, approved_release_date, imported.candidate_format,
      imported.candidate_cover_image_url, true, approved_printing_of_edition_id
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
        case when approved_release_date is not null then 'release_date' end
      ], null),
      imported.raw_payload, trim(p_decision_notes), true
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
      array['title'], imported.raw_payload, trim(p_decision_notes), false
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
      review_notes = trim(p_decision_notes),
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now(),
      updated_at = now()
  where id = p_catalogue_import_id;

  insert into public.catalogue_review_decisions (
    catalogue_import_id, decision, decision_notes, reviewed_by, resulting_edition_id
  ) values (
    p_catalogue_import_id, p_decision, trim(p_decision_notes), p_reviewed_by, resulting_edition_id
  );

  return resulting_edition_id;
end;
$$;

revoke all on function public.apply_catalogue_review(uuid, text, text, text, uuid, jsonb) from public;
