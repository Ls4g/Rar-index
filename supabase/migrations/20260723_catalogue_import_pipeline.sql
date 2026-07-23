-- Catalogue imports are kept separate from marketplace-price imports.
-- A source record is not an edition until a human reviewer approves it.
create table if not exists public.catalogue_import_queue (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id),
  external_id text not null,
  source_record_url text not null,
  raw_payload jsonb not null,
  candidate_kind text not null check (candidate_kind in ('edition_candidate', 'series_reference')),
  candidate_title text not null,
  candidate_series text,
  candidate_volume_number text,
  candidate_author text,
  candidate_publisher text,
  candidate_language text,
  candidate_isbn_13 text,
  candidate_release_date date,
  candidate_format text,
  candidate_cover_image_url text,
  status text not null default 'pending_review' check (status in ('pending_review', 'needs_review', 'approved', 'linked', 'rejected', 'duplicate')),
  matched_edition_id uuid references public.manga_editions(id),
  review_notes text,
  reviewed_by text,
  reviewed_at timestamptz,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, external_id)
);

alter table public.catalogue_import_queue enable row level security;
create index if not exists catalogue_import_queue_status_imported_idx
  on public.catalogue_import_queue(status, imported_at desc);
create index if not exists catalogue_import_queue_source_external_idx
  on public.catalogue_import_queue(source_id, external_id);

create table if not exists public.catalogue_review_decisions (
  id uuid primary key default gen_random_uuid(),
  catalogue_import_id uuid not null references public.catalogue_import_queue(id) on delete cascade,
  decision text not null check (decision in ('approve_new', 'link_existing', 'needs_review', 'rejected', 'duplicate')),
  decision_notes text not null check (length(trim(decision_notes)) >= 12),
  reviewed_by text not null,
  resulting_edition_id uuid references public.manga_editions(id),
  created_at timestamptz not null default now()
);

alter table public.catalogue_review_decisions enable row level security;
create index if not exists catalogue_review_decisions_import_created_idx
  on public.catalogue_review_decisions(catalogue_import_id, created_at desc);

create or replace function public.apply_catalogue_review(
  p_catalogue_import_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text,
  p_existing_edition_id uuid default null
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

    insert into public.manga_editions (
      title, series, volume_number, author, publisher, language, isbn_13,
      release_date, format, cover_image_url, is_verified
    ) values (
      imported.candidate_title, imported.candidate_series, imported.candidate_volume_number,
      imported.candidate_author, imported.candidate_publisher, imported.candidate_language,
      imported.candidate_isbn_13, imported.candidate_release_date, imported.candidate_format,
      imported.candidate_cover_image_url, true
    ) returning id into resulting_edition_id;

    insert into public.edition_sources (
      edition_id, source_id, source_record_url, external_id, fields_verified,
      source_data, verification_notes, is_primary
    ) values (
      resulting_edition_id, imported.source_id, imported.source_record_url, imported.external_id,
      array['title', 'language', 'isbn', 'publisher', 'release_date'], imported.raw_payload,
      trim(p_decision_notes), true
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
    p_catalogue_import_id, p_decision, trim(p_decision_notes), trim(p_reviewed_by), resulting_edition_id
  );

  return resulting_edition_id;
end;
$$;

revoke all on function public.apply_catalogue_review(uuid, text, text, text, uuid) from public;

create or replace view public.catalogue_review_queue
with (security_invoker = true)
as
select
  queue.*,
  source.name as source_name,
  edition.title as matched_edition_title
from public.catalogue_import_queue queue
join public.sources source on source.id = queue.source_id
left join public.manga_editions edition on edition.id = queue.matched_edition_id
where queue.status in ('pending_review', 'needs_review');
