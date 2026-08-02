-- A Scout lead may be watched or dismissed with no additional explanation.
-- The decision, reviewer and timestamp remain mandatory for the audit trail.
create or replace function public.apply_scout_lead_decision(
  p_lead_id uuid,
  p_decision text,
  p_decision_notes text,
  p_reviewed_by text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_decision not in ('watching', 'dismissed') then
    raise exception 'Invalid Scout lead decision';
  end if;
  if length(trim(coalesce(p_reviewed_by, ''))) = 0 then
    raise exception 'Scout lead decisions need a reviewer';
  end if;

  update public.scout_listing_leads
  set review_status = p_decision,
      review_notes = nullif(trim(coalesce(p_decision_notes, '')), ''),
      reviewed_by = trim(p_reviewed_by),
      reviewed_at = now(),
      updated_at = now()
  where id = p_lead_id;

  if not found then
    raise exception 'Scout lead not found';
  end if;

  insert into public.scout_lead_decisions (lead_id, decision, decision_notes, reviewed_by)
  values (p_lead_id, p_decision, trim(coalesce(p_decision_notes, '')), trim(p_reviewed_by));
end;
$$;

revoke all on function public.apply_scout_lead_decision(uuid, text, text, text) from public;
