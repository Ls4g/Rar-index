-- Staff-only cover discovery. Candidates are research leads and never publish
-- until a human reviewer explicitly verifies one.

create table if not exists public.cover_candidates (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.manga_editions(id) on delete cascade,
  source_name text not null,
  external_id text not null,
  cover_image_url text not null,
  source_record_url text not null,
  candidate_title text,
  candidate_publisher text,
  candidate_language text,
  candidate_isbn_13 text,
  match_score integer not null check (match_score between 0 and 100),
  match_confidence text not null check (match_confidence in ('strong', 'partial')),
  match_reasons jsonb not null default '[]'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  discovered_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_notes text,
  unique (edition_id, source_name, external_id)
);

create index if not exists cover_candidates_queue_idx
  on public.cover_candidates (status, match_score desc, discovered_at desc);
create index if not exists cover_candidates_edition_idx
  on public.cover_candidates (edition_id, status);

alter table public.cover_candidates enable row level security;

create table if not exists public.cover_candidate_scans (
  id uuid primary key default gen_random_uuid(),
  edition_id uuid not null references public.manga_editions(id) on delete cascade,
  sources text[] not null default array['Google Books', 'Open Library']::text[],
  candidates_found integer not null default 0 check (candidates_found >= 0),
  source_warnings jsonb not null default '[]'::jsonb,
  scanned_at timestamptz not null default now()
);

create index if not exists cover_candidate_scans_edition_idx
  on public.cover_candidate_scans (edition_id, scanned_at desc);

alter table public.cover_candidate_scans enable row level security;

create table if not exists public.cover_candidate_decisions (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.cover_candidates(id) on delete restrict,
  edition_id uuid not null references public.manga_editions(id) on delete restrict,
  decision text not null check (decision in ('verified', 'rejected')),
  decision_notes text not null check (char_length(trim(decision_notes)) >= 12),
  reviewed_by text not null check (char_length(trim(reviewed_by)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists cover_candidate_decisions_candidate_idx
  on public.cover_candidate_decisions (candidate_id, created_at desc);

alter table public.cover_candidate_decisions enable row level security;

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
begin
  if p_decision not in ('verified', 'rejected') then
    raise exception 'Choose verified or rejected.';
  end if;
  if nullif(trim(p_reviewed_by), '') is null then
    raise exception 'Reviewer is required.';
  end if;
  if char_length(trim(coalesce(p_decision_notes, ''))) < 12 then
    raise exception 'A review note of at least 12 characters is required.';
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
      v_candidate.source_record_url, v_candidate.source_name, trim(p_decision_notes), trim(p_reviewed_by)
    );
  end if;

  update public.cover_candidates
  set status = case when p_decision = 'verified' then 'approved' else 'rejected' end,
      reviewed_at = now(),
      reviewed_by = trim(p_reviewed_by),
      review_notes = trim(p_decision_notes)
  where id = p_candidate_id;

  insert into public.cover_candidate_decisions (
    candidate_id, edition_id, decision, decision_notes, reviewed_by
  ) values (
    v_candidate.id, v_candidate.edition_id, p_decision, trim(p_decision_notes), trim(p_reviewed_by)
  );
end;
$$;

revoke all on function public.apply_cover_candidate_decision(uuid, text, text, text) from public;
grant execute on function public.apply_cover_candidate_decision(uuid, text, text, text) to service_role;

comment on table public.cover_candidates is
  'Staff-only cover research leads. A candidate never publishes without apply_cover_candidate_decision by a human.';
comment on table public.cover_candidate_scans is
  'Audit of automated cover source checks, including empty searches and source warnings.';
comment on table public.cover_candidate_decisions is
  'Append-only audit trail for human cover candidate decisions.';
