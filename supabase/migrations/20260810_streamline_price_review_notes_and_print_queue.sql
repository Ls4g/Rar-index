-- Faster staff price workflow -------------------------------------------------
--
-- A decision is still fully auditable (reviewer, timestamp, decision and
-- original source remain mandatory), but a free-text note is not useful when
-- the source itself makes the decision self-evident. Notes are therefore
-- optional for internal price-match and print-classification decisions.
--
-- This does not relax the evidence bar for a first-print claim: it still
-- requires a direct proof URL tied to the exact sold copy.

alter table public.price_review_decisions
  drop constraint if exists price_review_decisions_decision_notes_check;

alter table public.price_print_classification_decisions
  drop constraint if exists price_print_classification_decisions_decision_notes_check;

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
  v_notes text := trim(coalesce(p_decision_notes, ''));
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
begin
  if p_decision not in ('verified_match', 'needs_review', 'excluded') then
    raise exception 'Invalid review decision';
  end if;
  if v_reviewer is null then
    raise exception 'Reviewer is required';
  end if;

  update public.price_observations
  set match_status = p_decision,
      is_verified = (p_decision = 'verified_match'),
      reviewed_at = now(),
      reviewed_by = v_reviewer,
      notes = concat_ws(E'\n', notes, nullif('Review: ' || v_notes, 'Review: ')),
      updated_at = now()
  where id = p_observation_id;

  if not found then
    raise exception 'Price observation % does not exist', p_observation_id;
  end if;

  insert into public.price_review_decisions (observation_id, decision, decision_notes, reviewed_by)
  values (p_observation_id, p_decision, v_notes, v_reviewer);
end;
$$;

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
  v_notes text := trim(coalesce(p_decision_notes, ''));
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

  update public.price_observations
  set print_classification = p_classification,
      printing_proof_url = v_proof_url,
      known_printing_number = p_known_printing_number,
      updated_at = now()
  where id = p_observation_id;

  if not found then
    raise exception 'Price observation % does not exist', p_observation_id;
  end if;

  insert into public.price_print_classification_decisions (
    observation_id, classification, printing_proof_url, known_printing_number, decision_notes, reviewed_by
  ) values (
    p_observation_id, p_classification, v_proof_url, p_known_printing_number, v_notes, v_reviewer
  );
end;
$$;

-- Only queue rows where a staff member has already supplied a direct
-- copyright-page image. A title saying "first print" is not proof and should
-- not create a compulsory second task after the sale match has been reviewed.
create or replace view public.print_classification_queue
with (security_invoker = true)
as
select
  po.id as observation_id,
  po.edition_id,
  edition.title,
  edition.series,
  edition.volume_number,
  edition.language,
  edition.publisher,
  po.listing_title,
  po.source_listing_url,
  po.sold_date,
  po.sale_price,
  po.currency,
  po.print_classification,
  true as has_unreviewed_evidence_hint
from public.price_observations po
join public.manga_editions edition on edition.id = po.edition_id
where po.match_status = 'verified_match'
  and po.sale_status = 'confirmed'
  and po.print_classification = 'printing_not_identified'
  and po.raw_payload::text ~* 'evidence_image_url"\\s*:\\s*"http'
order by po.sold_date desc nulls last;

notify pgrst, 'reload schema';
