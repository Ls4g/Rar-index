-- Evidence notes were forced to 12+ characters on every review decision, even
-- when the match is obvious and there is nothing extra worth writing. Make
-- the note optional; a decision and a reviewer are still always required.
alter table public.price_review_decisions
  alter column decision_notes drop not null,
  drop constraint if exists price_review_decisions_decision_notes_check;

create or replace function public.apply_price_review(
  p_observation_id uuid,
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
  if p_decision not in ('verified_match', 'needs_review', 'excluded') then
    raise exception 'Invalid review decision';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Reviewer is required';
  end if;

  update public.price_observations
  set match_status = p_decision,
      is_verified = (p_decision = 'verified_match'),
      reviewed_at = now(),
      reviewed_by = trim(p_reviewed_by),
      notes = case when v_notes is null then notes else concat_ws(E'\n', notes, 'Review: ' || v_notes) end,
      updated_at = now()
  where id = p_observation_id;

  if not found then
    raise exception 'Price observation % does not exist', p_observation_id;
  end if;

  insert into public.price_review_decisions (observation_id, decision, decision_notes, reviewed_by)
  values (p_observation_id, p_decision, v_notes, trim(p_reviewed_by));
end;
$$;
