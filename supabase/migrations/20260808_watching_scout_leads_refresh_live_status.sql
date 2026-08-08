-- A staff member choosing Watch has checked that the active listing is still
-- live. Treat that human confirmation as the latest sighting for the public
-- live-listings feed. This never creates a sale or changes valuation data.
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
declare
  v_reviewed_at timestamptz := now();
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
      reviewed_at = v_reviewed_at,
      last_seen_at = case
        when p_decision = 'watching' then greatest(coalesce(last_seen_at, '-infinity'::timestamptz), v_reviewed_at)
        else last_seen_at
      end,
      updated_at = v_reviewed_at
  where id = p_lead_id
    and review_status = 'new';

  if not found then
    raise exception 'Scout lead has already been reviewed or was not found';
  end if;

  insert into public.scout_lead_decisions (lead_id, decision, decision_notes, reviewed_by)
  values (p_lead_id, p_decision, trim(coalesce(p_decision_notes, '')), trim(p_reviewed_by));
end;
$$;

-- Preserve the real time of existing human Watch decisions. Older watches do
-- not become fresh; only records reviewed within the usual live-feed window
-- can surface as live today.
update public.scout_listing_leads
set last_seen_at = reviewed_at,
    updated_at = now()
where review_status = 'watching'
  and reviewed_at is not null
  and reviewed_at > last_seen_at;

revoke all on function public.apply_scout_lead_decision(uuid, text, text, text) from public;
