-- Human-approved sold-listing intake -----------------------------------------
--
-- Staff bring the complete evidence into RAR. This workflow never fetches a
-- marketplace page after submission and never creates a second review task.
-- One database transaction writes the verified observation, its exact-edition
-- review, its print classification, and the intake audit row together.

create table if not exists public.sale_intake_decisions (
  id uuid primary key default gen_random_uuid(),
  observation_id uuid references public.price_observations(id) on delete restrict,
  edition_id uuid not null references public.manga_editions(id) on delete restrict,
  source_id uuid not null references public.sources(id) on delete restrict,
  external_id text not null check (length(trim(external_id)) > 0),
  source_listing_url text not null check (source_listing_url ~* '^https?://'),
  listing_title text not null check (length(trim(listing_title)) > 0),
  decision text not null check (decision in ('approved', 'rejected')),
  reason_label text,
  detector_output jsonb not null default '{}'::jsonb,
  confirmed_output jsonb not null default '{}'::jsonb,
  submitted_payload jsonb not null default '{}'::jsonb,
  decision_notes text,
  reviewed_by text not null check (length(trim(reviewed_by)) > 0),
  created_at timestamptz not null default now(),
  check (decision <> 'approved' or observation_id is not null)
);

create index if not exists sale_intake_decisions_source_external_idx
  on public.sale_intake_decisions(source_id, external_id, created_at desc);
create index if not exists sale_intake_decisions_edition_created_idx
  on public.sale_intake_decisions(edition_id, created_at desc);

alter table public.sale_intake_decisions enable row level security;
revoke all on public.sale_intake_decisions from anon, authenticated;

drop trigger if exists sale_intake_decisions_append_only on public.sale_intake_decisions;
create trigger sale_intake_decisions_append_only
before update or delete on public.sale_intake_decisions
for each row execute function public.block_agent_reliability_mutation();

create or replace function public.approve_submitted_sale(
  p_edition_id uuid,
  p_source_id uuid,
  p_source_listing_url text,
  p_external_id text,
  p_listing_title text,
  p_sold_date date,
  p_sale_price numeric,
  p_currency text,
  p_shipping_price numeric,
  p_quantity integer,
  p_sale_type text,
  p_grading_company text,
  p_grade_label text,
  p_print_classification text,
  p_printing_proof_url text,
  p_known_printing_number integer,
  p_price_corroboration_url text,
  p_submitted_payload jsonb,
  p_detector_output jsonb,
  p_decision_notes text,
  p_reviewed_by text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_observation_id uuid;
  v_intake_id uuid;
  v_source_url text := trim(coalesce(p_source_listing_url, ''));
  v_external_id text := trim(coalesce(p_external_id, ''));
  v_title text := trim(coalesce(p_listing_title, ''));
  v_currency text := upper(trim(coalesce(p_currency, '')));
  v_company text := nullif(upper(trim(coalesce(p_grading_company, ''))), '');
  v_grade text := nullif(trim(coalesce(p_grade_label, '')), '');
  v_proof_url text := nullif(trim(coalesce(p_printing_proof_url, '')), '');
  v_corroboration_url text := nullif(trim(coalesce(p_price_corroboration_url, '')), '');
  v_notes text := trim(coalesce(p_decision_notes, ''));
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
begin
  if v_reviewer is null then raise exception 'Reviewer is required'; end if;
  if v_source_url = '' or v_source_url !~* '^https?://' then raise exception 'A working original source URL is required'; end if;
  if v_external_id = '' then raise exception 'Marketplace listing ID is required'; end if;
  if v_title = '' then raise exception 'Listing title is required'; end if;
  if p_sold_date is null or p_sold_date > current_date then raise exception 'A completed sale date is required'; end if;
  if p_sale_price is null or p_sale_price <= 0 then raise exception 'Sale price must be greater than zero'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'Currency must be a three-letter code'; end if;
  if p_shipping_price is not null and p_shipping_price < 0 then raise exception 'Shipping price cannot be negative'; end if;
  if p_quantity is null or p_quantity < 1 then raise exception 'Quantity must be at least one'; end if;
  if p_sale_type not in ('auction', 'best_offer', 'fixed_price', 'unknown') then raise exception 'Invalid sale type'; end if;
  if p_print_classification not in ('first_print_proven', 'known_later_print', 'printing_not_identified') then raise exception 'Invalid print classification'; end if;
  if (v_company is null) <> (v_grade is null) then raise exception 'A graded sale requires both grading company and grade'; end if;
  if p_print_classification = 'first_print_proven' and v_proof_url is null then raise exception 'First-print approval requires direct printing proof'; end if;
  if p_known_printing_number is not null and p_known_printing_number < 1 then raise exception 'Known printing number must be positive'; end if;
  if p_sale_type = 'best_offer' and v_corroboration_url is null then raise exception 'Best Offer sales require an actual-price corroboration URL'; end if;
  if v_proof_url is not null and v_proof_url !~* '^https?://' then raise exception 'Printing proof must be a valid URL'; end if;
  if v_corroboration_url is not null and v_corroboration_url !~* '^https?://' then raise exception 'Price corroboration must be a valid URL'; end if;
  if not exists (select 1 from public.manga_editions where id = p_edition_id and is_verified = true) then raise exception 'Choose a verified RAR edition'; end if;
  if not exists (select 1 from public.sources where id = p_source_id and is_active = true) then raise exception 'Choose an active marketplace source'; end if;

  insert into public.price_observations (
    edition_id, collection_run_id, source_id, source_listing_url, external_id,
    listing_title, sold_date, sale_price, currency, shipping_price, quantity,
    sale_type, grading_company, grade_label, raw_payload, is_verified, notes,
    match_status, reviewed_at, reviewed_by, sale_status, print_classification,
    printing_proof_url, known_printing_number
  ) values (
    p_edition_id, null, p_source_id, v_source_url, v_external_id,
    v_title, p_sold_date, p_sale_price, v_currency, p_shipping_price, p_quantity,
    p_sale_type, v_company, v_grade,
    coalesce(p_submitted_payload, '{}'::jsonb) || jsonb_build_object(
      'source', 'approved-listing-v1',
      'intake_method', 'staff_submitted_evidence',
      'captured_at', now(),
      'evidence_image_url', v_proof_url,
      'price_corroboration_url', v_corroboration_url,
      'detector_output', coalesce(p_detector_output, '{}'::jsonb),
      'quantity_interpretation', case when p_quantity > 1 then 'one listing-level observation; quantity does not create extra chart points' else 'single observed sale' end
    ),
    true,
    concat_ws(E'\n', 'Approved through staff-submitted evidence. Item price excludes delivery.', nullif(v_notes, '')),
    'verified_match', now(), v_reviewer, 'confirmed', p_print_classification,
    v_proof_url, p_known_printing_number
  ) returning id into v_observation_id;

  insert into public.price_review_decisions (observation_id, decision, decision_notes, reviewed_by)
  values (v_observation_id, 'verified_match', v_notes, v_reviewer);

  insert into public.price_print_classification_decisions (
    observation_id, classification, printing_proof_url, known_printing_number,
    decision_notes, reviewed_by
  ) values (
    v_observation_id, p_print_classification, v_proof_url,
    p_known_printing_number, v_notes, v_reviewer
  );

  insert into public.sale_intake_decisions (
    observation_id, edition_id, source_id, external_id, source_listing_url,
    listing_title, decision, reason_label, detector_output, confirmed_output,
    submitted_payload, decision_notes, reviewed_by
  ) values (
    v_observation_id, p_edition_id, p_source_id, v_external_id, v_source_url,
    v_title, 'approved', 'approved_listing', coalesce(p_detector_output, '{}'::jsonb),
    jsonb_build_object(
      'edition_id', p_edition_id, 'source_listing_url', v_source_url,
      'external_id', v_external_id, 'listing_title', v_title,
      'sold_date', p_sold_date, 'sale_price', p_sale_price,
      'currency', v_currency, 'shipping_price', p_shipping_price,
      'quantity', p_quantity, 'sale_type', p_sale_type,
      'grading_company', v_company, 'grade_label', v_grade,
      'print_classification', p_print_classification,
      'printing_proof_url', v_proof_url,
      'price_corroboration_url', v_corroboration_url
    ),
    coalesce(p_submitted_payload, '{}'::jsonb), v_notes, v_reviewer
  ) returning id into v_intake_id;

  insert into public.agent_human_feedback (
    workflow, subject_key, outcome, reason_label, note, reviewed_by
  ) values (
    'sale', 'sale:' || v_observation_id::text, 'verified_match',
    'approved_listing', nullif(v_notes, ''), v_reviewer
  );

  return v_observation_id;
exception
  when unique_violation then
    raise exception 'This marketplace listing already exists in RAR';
end;
$$;

create or replace function public.reject_submitted_sale(
  p_edition_id uuid,
  p_source_id uuid,
  p_source_listing_url text,
  p_external_id text,
  p_listing_title text,
  p_reason_label text,
  p_submitted_payload jsonb,
  p_detector_output jsonb,
  p_decision_notes text,
  p_reviewed_by text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
  v_reason text := trim(coalesce(p_reason_label, ''));
  v_url text := trim(coalesce(p_source_listing_url, ''));
  v_external_id text := trim(coalesce(p_external_id, ''));
  v_title text := trim(coalesce(p_listing_title, ''));
begin
  if v_reviewer is null then raise exception 'Reviewer is required'; end if;
  if v_reason not in ('wrong_edition', 'not_completed', 'best_offer_unconfirmed', 'multi_volume_lot', 'duplicate_listing', 'insufficient_evidence', 'other') then raise exception 'Choose a rejection reason'; end if;
  if v_url = '' or v_url !~* '^https?://' then raise exception 'Source URL is required'; end if;
  if v_external_id = '' then raise exception 'Marketplace listing ID is required'; end if;
  if v_title = '' then raise exception 'Listing title is required'; end if;
  if not exists (select 1 from public.manga_editions where id = p_edition_id and is_verified = true) then raise exception 'Choose a verified RAR edition'; end if;
  if not exists (select 1 from public.sources where id = p_source_id and is_active = true) then raise exception 'Choose an active marketplace source'; end if;

  insert into public.sale_intake_decisions (
    edition_id, source_id, external_id, source_listing_url, listing_title,
    decision, reason_label, detector_output, submitted_payload,
    decision_notes, reviewed_by
  ) values (
    p_edition_id, p_source_id, v_external_id, v_url, v_title,
    'rejected', v_reason, coalesce(p_detector_output, '{}'::jsonb),
    coalesce(p_submitted_payload, '{}'::jsonb),
    trim(coalesce(p_decision_notes, '')), v_reviewer
  ) returning id into v_id;

  insert into public.agent_human_feedback (
    workflow, subject_key, outcome, reason_label, note, reviewed_by
  ) values (
    'sale', 'sale-intake:' || v_id::text, 'excluded', v_reason,
    nullif(trim(coalesce(p_decision_notes, '')), ''), v_reviewer
  );

  return v_id;
end;
$$;

revoke all on function public.approve_submitted_sale(uuid, uuid, text, text, text, date, numeric, text, numeric, integer, text, text, text, text, text, integer, text, jsonb, jsonb, text, text) from public;
revoke all on function public.reject_submitted_sale(uuid, uuid, text, text, text, text, jsonb, jsonb, text, text) from public;
grant execute on function public.approve_submitted_sale(uuid, uuid, text, text, text, date, numeric, text, numeric, integer, text, text, text, text, text, integer, text, jsonb, jsonb, text, text) to service_role;
grant execute on function public.reject_submitted_sale(uuid, uuid, text, text, text, text, jsonb, jsonb, text, text) to service_role;

comment on table public.sale_intake_decisions is
  'Append-only human decisions on staff-submitted sold-listing evidence, including detector output and human corrections for controlled learning.';

notify pgrst, 'reload schema';
