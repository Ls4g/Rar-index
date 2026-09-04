-- The last mandatory review note.
--
-- 20260814_optional_review_notes.sql removed the 12-character minimum from
-- every review decision on the site. It missed one: apply_cover_candidate_
-- decision. That migration dropped the NOT NULL and the check constraint on
-- cover_candidate_decisions, but the function it rebuilt kept the length test
-- in its body, so approving a discovered cover candidate still refused an
-- empty note while every other decision accepted one.
--
-- Verified live before writing this: of the eight apply_* decision functions,
-- seven report "note optional" and only this one still contains the < 12
-- test.
--
-- The reasoning is unchanged from that migration. A character count is not
-- evidence. It adds friction to the cheapest decision in the system, and it
-- invites padding -- "confirmed confirmed" is worse audit data than an empty
-- note beside a named reviewer and a timestamp.
--
-- Every real guard below is preserved exactly: a reviewer is still required,
-- a candidate that already has a human decision still cannot be overwritten,
-- an edition that already has a verified cover still cannot be silently
-- replaced, and approval still writes to both audit tables.

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
  -- A human decision is never overwritten by another one.
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
