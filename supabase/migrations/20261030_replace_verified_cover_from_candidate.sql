-- A staff member may deliberately replace a verified cover with a reviewed
-- discovery candidate. Keep both the old and new image provenance in the
-- audit trail; ordinary candidate approval still refuses verified editions.
alter table public.cover_review_decisions
  add column if not exists previous_cover_image_url text,
  add column if not exists previous_cover_source_url text,
  add column if not exists previous_cover_source_name text;

create or replace function public.replace_verified_cover_from_candidate(
  p_candidate_id uuid,
  p_edition_id uuid,
  p_expected_cover_image_url text,
  p_expected_cover_source_url text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate public.cover_candidates%rowtype;
  v_edition public.manga_editions%rowtype;
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
begin
  if v_reviewer is null then
    raise exception 'Reviewer is required.';
  end if;

  select * into v_candidate from public.cover_candidates
  where id = p_candidate_id for update;
  if not found or v_candidate.edition_id <> p_edition_id then
    raise exception 'This candidate does not belong to the selected edition.';
  end if;
  if v_candidate.status <> 'pending' then
    raise exception 'This cover candidate already has a human decision.';
  end if;

  select * into v_edition from public.manga_editions
  where id = p_edition_id for update;
  if not found or v_edition.cover_verification_status <> 'verified' then
    raise exception 'This edition does not have a verified cover to replace.';
  end if;
  if v_edition.cover_image_url is distinct from p_expected_cover_image_url
     or v_edition.cover_source_url is distinct from p_expected_cover_source_url then
    raise exception 'The cover changed while you were reviewing it. Refresh and compare again.';
  end if;
  if v_edition.cover_image_url = v_candidate.cover_image_url then
    raise exception 'This candidate is already the current cover.';
  end if;

  update public.manga_editions
  set cover_image_url = v_candidate.cover_image_url,
      cover_source_url = v_candidate.source_record_url,
      cover_source_name = v_candidate.source_name,
      cover_verification_status = 'verified',
      cover_verified_at = now(),
      updated_at = now()
  where id = p_edition_id;

  update public.cover_candidates
  set status = 'approved', reviewed_at = now(), reviewed_by = v_reviewer,
      review_notes = 'Staff selected this cover as a replacement.'
  where id = p_candidate_id;

  insert into public.cover_review_decisions (
    edition_id, previous_status, decision, cover_image_url, cover_source_url,
    cover_source_name, previous_cover_image_url, previous_cover_source_url,
    previous_cover_source_name, decision_notes, reviewed_by
  ) values (
    p_edition_id, 'verified', 'verified', v_candidate.cover_image_url,
    v_candidate.source_record_url, v_candidate.source_name,
    v_edition.cover_image_url, v_edition.cover_source_url,
    v_edition.cover_source_name, 'Staff selected a higher-quality cover candidate.', v_reviewer
  );

  insert into public.cover_candidate_decisions (
    candidate_id, edition_id, decision, decision_notes, reviewed_by
  ) values (
    p_candidate_id, p_edition_id, 'verified',
    'Staff selected this cover as a replacement.', v_reviewer
  );
end;
$$;

revoke all on function public.replace_verified_cover_from_candidate(uuid, uuid, text, text, text) from public;
grant execute on function public.replace_verified_cover_from_candidate(uuid, uuid, text, text, text) to service_role;
