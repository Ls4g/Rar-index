-- Remove the 12-character minimum from every review note on the site.
--
-- The rule was never an evidence requirement. AGENTS.md asks that a human
-- makes each decision, that nothing auto-verifies, and that every decision
-- lands in an audit table -- none of which a character count contributes to.
-- What it did contribute was friction on the two cheapest decisions in the
-- system (a cover, a catalogue record) while the two most consequential
-- ones (verifying a sale, proving a first print) asked for no note at all.
--
-- It also produced worse audit data than having no minimum. A length gate on
-- an obvious match invites padding to clear it, and "confirmed confirmed" is
-- less use to a future reader than an empty note beside a named reviewer and
-- a timestamp.
--
-- Every other guard is untouched and deliberately so: a reviewer is still
-- required on every decision, a verified cover still needs an image, source
-- URL and source name, a first-print classification still needs a direct
-- printing-proof URL, and approving a duplicate ISBN still needs the
-- existing edition named. Nothing here relaxes what counts as evidence.

-- 1. Let every audit table store an empty note --------------------------------
-- Constraints were declared inline, so their names are generated. Drop any
-- check constraint on these tables that references decision_notes rather than
-- guessing at a suffix.
do $$
declare
  target record;
begin
  for target in
    select c.conrelid::regclass as table_name, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid::regclass::text in (
        'catalogue_review_decisions',
        'community_report_decisions',
        'catalogue_request_decisions',
        'scout_lead_decisions',
        'cover_review_decisions',
        'price_print_classification_decisions',
        'cover_candidate_decisions',
        'price_review_decisions'
      )
      and pg_get_constraintdef(c.oid) ilike '%decision_notes%'
  loop
    execute format('alter table public.%s drop constraint %I', target.table_name, target.conname);
  end loop;
end;
$$;

alter table public.catalogue_review_decisions alter column decision_notes drop not null;
alter table public.community_report_decisions alter column decision_notes drop not null;
alter table public.catalogue_request_decisions alter column decision_notes drop not null;
alter table public.scout_lead_decisions alter column decision_notes drop not null;
alter table public.cover_review_decisions alter column decision_notes drop not null;
alter table public.price_print_classification_decisions alter column decision_notes drop not null;
alter table public.cover_candidate_decisions alter column decision_notes drop not null;

-- 2. apply_catalogue_review ---------------------------------------------------
-- Note: a second, five-argument overload of this function is also live and is
-- NOT touched here, because create or replace only matches an exact signature.
-- It is unreachable from the app (the API always sends p_metadata, so calls
-- resolve to the six-argument form below) but it is a real hazard for a
-- separate reason -- see 20260814_drop_stale_catalogue_review_overload.sql.
--
-- Reproduces the 2026-08-04 definition, including the duplicate-ISBN printing
-- guard, with the note length check removed and an empty note stored as null.
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

-- 3. apply_community_report_decision -----------------------------------------
create or replace function public.apply_community_report_decision(
  p_report_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
begin
  if p_decision not in ('reviewed', 'rejected', 'converted') then
    raise exception 'Invalid community report decision';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Reviewer is required';
  end if;

  update public.community_sale_reports
  set status = p_decision,
      staff_notes = v_notes,
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now()
  where id = p_report_id
    and status = 'pending';

  if not found then
    raise exception 'Community report % is not pending or does not exist', p_report_id;
  end if;

  insert into public.community_report_decisions (report_id, decision, decision_notes, reviewed_by)
  values (p_report_id, p_decision, v_notes, trim(p_reviewed_by));
end;
$$;

revoke all on function public.apply_community_report_decision(uuid, text, text, text) from public;

-- 4. apply_catalogue_request_decision -----------------------------------------
create or replace function public.apply_catalogue_request_decision(
  p_request_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
begin
  if p_decision not in ('queued_for_research', 'declined', 'added_to_catalogue') then
    raise exception 'Invalid catalogue request decision';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Reviewer is required';
  end if;

  update public.catalogue_requests
  set status = p_decision,
      staff_notes = v_notes,
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now()
  where id = p_request_id
    and status = 'pending';

  if not found then
    raise exception 'Catalogue request % is not pending or does not exist', p_request_id;
  end if;

  insert into public.catalogue_request_decisions (request_id, decision, decision_notes, reviewed_by)
  values (p_request_id, p_decision, v_notes, trim(p_reviewed_by));
end;
$$;

revoke all on function public.apply_catalogue_request_decision(uuid, text, text, text) from public;

-- 5. apply_cover_review -------------------------------------------------------
-- The image / source-URL / source-name requirements on a verified cover are
-- kept exactly as they were; only the note length goes.
create or replace function public.apply_cover_review(
  p_edition_id uuid,
  p_decision text,
  p_cover_image_url text,
  p_cover_source_url text,
  p_cover_source_name text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_image_url text := nullif(trim(coalesce(p_cover_image_url, '')), '');
  v_source_url text := nullif(trim(coalesce(p_cover_source_url, '')), '');
  v_source_name text := nullif(trim(coalesce(p_cover_source_name, '')), '');
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
  v_previous_status text;
begin
  if p_decision not in ('candidate', 'verified', 'rejected') then
    raise exception 'Invalid cover review decision';
  end if;
  if v_reviewer is null then
    raise exception 'Reviewer is required';
  end if;
  if p_decision = 'verified' and (v_image_url is null or v_source_url is null or v_source_name is null) then
    raise exception 'A verified cover requires an image URL, a source record URL, and a source name';
  end if;
  if p_decision = 'candidate' and v_image_url is null and v_source_url is null then
    raise exception 'A candidate cover needs at least an image URL or a source record URL';
  end if;

  select cover_verification_status into v_previous_status
  from public.manga_editions
  where id = p_edition_id
  for update;

  if not found then
    raise exception 'Edition % does not exist', p_edition_id;
  end if;

  if p_decision = 'rejected' then
    update public.manga_editions
    set cover_image_url = null,
        cover_source_url = null,
        cover_source_name = null,
        cover_verification_status = 'rejected',
        cover_verified_at = null,
        updated_at = now()
    where id = p_edition_id;
  else
    update public.manga_editions
    set cover_image_url = v_image_url,
        cover_source_url = v_source_url,
        cover_source_name = v_source_name,
        cover_verification_status = p_decision,
        cover_verified_at = case when p_decision = 'verified' then now() else null end,
        updated_at = now()
    where id = p_edition_id;
  end if;

  insert into public.cover_review_decisions (
    edition_id, previous_status, decision, cover_image_url, cover_source_url, cover_source_name, decision_notes, reviewed_by
  ) values (
    p_edition_id, v_previous_status, p_decision, v_image_url, v_source_url, v_source_name, v_notes, v_reviewer
  );
end;
$$;

revoke all on function public.apply_cover_review(uuid, text, text, text, text, text, text) from public;

-- 6. apply_price_print_classification -----------------------------------------
-- The printing-proof URL stays mandatory for a first-print claim. That is the
-- evidence; the note never was.
create or replace function public.apply_price_print_classification(
  p_observation_id uuid,
  p_classification text,
  p_printing_proof_url text,
  p_known_printing_number integer,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proof_url text := nullif(trim(coalesce(p_printing_proof_url, '')), '');
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
begin
  if p_classification not in ('first_print_proven', 'known_later_print', 'printing_not_identified') then
    raise exception 'Invalid print classification';
  end if;
  if v_reviewer is null then
    raise exception 'Reviewer is required';
  end if;
  if p_classification = 'first_print_proven' and v_proof_url is null then
    raise exception 'A first-print classification requires a direct printing-proof URL';
  end if;
  if p_known_printing_number is not null and p_known_printing_number < 1 then
    raise exception 'Known printing number must be a positive number';
  end if;
  if not exists (select 1 from public.price_observations where id = p_observation_id) then
    raise exception 'Price observation % does not exist', p_observation_id;
  end if;

  update public.price_observations
  set print_classification = p_classification,
      printing_proof_url = v_proof_url,
      known_printing_number = p_known_printing_number,
      updated_at = now()
  where id = p_observation_id;

  insert into public.price_print_classification_decisions (
    observation_id, classification, printing_proof_url, known_printing_number, decision_notes, reviewed_by
  ) values (
    p_observation_id, p_classification, v_proof_url, p_known_printing_number, v_notes, v_reviewer
  );
end;
$$;

revoke all on function public.apply_price_print_classification(uuid, text, text, integer, text, text) from public;

-- 7. apply_cover_candidate_decision -------------------------------------------
-- The "already has a human decision" and "already has a verified cover" guards
-- are kept: this function still cannot overwrite a prior human decision.
create or replace function public.apply_cover_candidate_decision(
  p_candidate_id uuid,
  p_decision text,
  p_reviewed_by text,
  p_decision_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.cover_candidates%rowtype;
  v_previous_status text;
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
begin
  if p_decision not in ('verified', 'rejected') then
    raise exception 'Choose verified or rejected.';
  end if;
  if v_reviewer is null then
    raise exception 'Reviewer is required.';
  end if;

  select * into v_candidate
  from public.cover_candidates
  where id = p_candidate_id
  for update;

  if not found then
    raise exception 'Cover candidate was not found.';
  end if;
  if v_candidate.status <> 'pending' then
    raise exception 'This cover candidate already has a human decision.';
  end if;

  if p_decision = 'verified' then
    select cover_verification_status into v_previous_status
    from public.manga_editions
    where id = v_candidate.edition_id
    for update;

    if not found then
      raise exception 'Edition was not found.';
    end if;
    if v_previous_status = 'verified' then
      raise exception 'This edition already has a verified cover. Use the manual correction workflow.';
    end if;

    update public.manga_editions
    set cover_image_url = v_candidate.cover_image_url,
        cover_source_url = v_candidate.source_record_url,
        cover_source_name = v_candidate.source_name,
        cover_verification_status = 'verified',
        cover_verified_at = now(),
        updated_at = now()
    where id = v_candidate.edition_id;

    insert into public.cover_review_decisions (
      edition_id, previous_status, decision, cover_image_url, cover_source_url,
      cover_source_name, decision_notes, reviewed_by
    ) values (
      v_candidate.edition_id, v_previous_status, 'verified', v_candidate.cover_image_url,
      v_candidate.source_record_url, v_candidate.source_name, v_notes, v_reviewer
    );
  end if;

  update public.cover_candidates
  set status = case when p_decision = 'verified' then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = v_reviewer,
      review_notes = v_notes
  where id = p_candidate_id;

  insert into public.cover_candidate_decisions (
    candidate_id, edition_id, decision, decision_notes, reviewed_by
  ) values (
    v_candidate.id, v_candidate.edition_id, p_decision, v_notes, v_reviewer
  );
end;
$$;

revoke all on function public.apply_cover_candidate_decision(uuid, text, text, text) from public;
grant execute on function public.apply_cover_candidate_decision(uuid, text, text, text) to service_role;
