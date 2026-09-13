-- Atomic outcome-to-sale completion -----------------------------------------
--
-- Additive only: one new function, one new index. No column, constraint,
-- function or row that already exists is altered or dropped.
--
-- The problem this closes. Confirming a watched listing as a sale was two
-- separate database round trips: `approve_submitted_sale` wrote the
-- observation, its review decision, its print classification and its intake
-- audit inside one transaction, and then a second, independent UPDATE closed
-- the `listing_outcomes` row. Between those two calls anything could happen:
--
--   * another member of staff dismissed the same outcome, so the sale existed
--     as verified evidence while its outcome recorded "did not sell";
--   * a background outcome check rewrote status/attempt counters underneath;
--   * the request crashed or timed out, leaving verified evidence attached to
--     an outcome still sitting in the sold-candidate queue, to be offered to a
--     human again.
--
-- The TypeScript caller guarded the second write with conditional columns,
-- which stops it *overwriting* a human decision but cannot stop the split from
-- happening. Only one transaction can.
--
-- What this function does, in order, inside a single transaction:
--   1. locks the outcome row (`for update`), so every concurrent writer on
--      that row queues behind this decision rather than interleaving with it;
--   2. returns idempotently if the outcome already carries an observation,
--      without writing anything -- this is what makes a retry safe;
--   3. refuses if another human already reviewed it, naming who;
--   4. checks the completed-sale evidence is actually present;
--   5. reuses an existing verified observation for the same listing, or calls
--      the existing `approve_submitted_sale` to create one;
--   6. closes the outcome.
--
-- Step 5 deliberately calls the existing intake function rather than copying
-- its body. A plpgsql function called from another runs in the same
-- transaction, so atomicity holds across both, and there is exactly one place
-- where a verified observation is ever created -- which is the point of that
-- function existing. Any exception it raises rolls this whole unit back.
--
-- Nothing here verifies anything on a human's behalf. The caller must already
-- have collected an explicit human confirmation; this function only makes the
-- resulting write indivisible.

-- eBay is inconsistent about listing identifiers: the Browse API returns
-- `v1|123456789012|0` while Trading, the legacy APIs and the listing URL all
-- use the bare number. The unique index on (source_id, external_id) treats
-- those two spellings as different listings, so a lookup that checks only one
-- form will happily create a second observation for a sale RAR already holds.
-- Every lookup below therefore checks both forms.
create index if not exists price_observations_source_external_lookup_idx
  on public.price_observations(source_id, external_id);

create or replace function public.confirm_outcome_sale(
  p_outcome_id uuid,
  p_legacy_external_id text,
  p_sale_type text,
  p_grading_company text,
  p_grade_label text,
  p_price_corroboration_url text,
  p_submitted_payload jsonb,
  p_detector_output jsonb,
  p_decision_notes text,
  p_reviewed_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outcome public.listing_outcomes%rowtype;
  v_observation_id uuid;
  v_existing record;
  v_stored_legacy text;
  v_legacy text := trim(coalesce(p_legacy_external_id, ''));
  v_reviewer text := nullif(trim(coalesce(p_reviewed_by, '')), '');
  v_notes text := nullif(trim(coalesce(p_decision_notes, '')), '');
  v_reused boolean := false;
begin
  if v_reviewer is null then
    raise exception 'Add your name or initials so the decision is attributable.';
  end if;
  if v_legacy !~ '^\d{6,}$' then
    raise exception 'A numeric marketplace listing ID is required.';
  end if;

  -- The lock. Held until this transaction ends, so a concurrent dismissal,
  -- keep-watching or background check on this outcome waits here and then
  -- re-evaluates its own WHERE clause against the row this decision leaves
  -- behind -- which is how those writers correctly report a conflict instead
  -- of silently overwriting a verification.
  select * into v_outcome from public.listing_outcomes where id = p_outcome_id for update;
  if not found then
    raise exception 'That listing outcome no longer exists.';
  end if;

  -- Idempotent retry. A caller whose connection dropped after the sale was
  -- committed sees the same answer as the call that succeeded, and no second
  -- observation is created, reviewed or reassigned.
  if v_outcome.resulting_observation_id is not null then
    return jsonb_build_object(
      'ok', true,
      'status', v_outcome.status,
      'observationId', v_outcome.resulting_observation_id,
      'reused', true,
      'alreadyClosed', true
    );
  end if;

  if v_outcome.reviewed_by is not null then
    raise exception 'Already reviewed by %. Refresh before deciding again; nothing was changed.', v_outcome.reviewed_by;
  end if;
  if v_outcome.status <> 'sold_candidate' then
    raise exception 'Only a sold candidate can be confirmed as a sale. This listing is currently "%".', replace(v_outcome.status, '_', ' ');
  end if;

  -- Completed-sale evidence must already be on the row. This function never
  -- invents a price, a currency or a date, and never promotes an ended,
  -- ambiguous or inaccessible listing into a sale.
  if v_outcome.sold_price is null or v_outcome.sold_price <= 0 then
    raise exception 'This candidate has no completed-sale price, so it cannot become a sale.';
  end if;
  if coalesce(v_outcome.sold_currency, '') !~ '^[A-Z]{3}$' then
    raise exception 'This candidate has no valid currency, so it cannot become a sale.';
  end if;
  if v_outcome.sold_at is null or v_outcome.sold_at > now() then
    raise exception 'This candidate has no usable completed-sale date, so it cannot become a sale.';
  end if;
  if coalesce(trim(v_outcome.source_listing_url), '') !~* '^https?://' then
    raise exception 'A working original listing link is required.';
  end if;

  -- The caller derived the numeric id from the original listing URL. Checking
  -- it here as well means a mismatch cannot slip through a code path that
  -- forgot to look.
  v_stored_legacy := coalesce(substring(v_outcome.external_id from '^v\d+\|(\d+)\|'), v_outcome.external_id);
  if v_stored_legacy <> v_legacy then
    raise exception 'The original eBay link and the stored listing ID do not agree. Resolve the source before verifying.';
  end if;

  -- Both spellings of the same listing id, so a retry cannot duplicate
  -- evidence that arrived through a different eBay API.
  select id, edition_id, match_status, sale_status, is_verified
    into v_existing
    from public.price_observations
   where source_id = v_outcome.source_id
     and (external_id = v_legacy or external_id like 'v1|' || v_legacy || '|%')
   limit 1;

  if found then
    -- An existing human decision is never re-made, re-verified or moved to a
    -- different edition. Either it already is exactly this sale, or a human
    -- resolves it in sale review.
    if v_existing.edition_id <> v_outcome.edition_id then
      raise exception 'This listing already belongs to another edition. Open sale review to resolve the match; nothing was changed.';
    end if;
    if v_existing.match_status <> 'verified_match'
       or v_existing.sale_status <> 'confirmed'
       or v_existing.is_verified is not true then
      raise exception 'This listing already has an unverified or excluded observation. Finish it in sale review; its existing decision was not changed.';
    end if;
    v_observation_id := v_existing.id;
    v_reused := true;
  else
    -- The existing transactional intake. Writes the observation, its
    -- verified-match review, its print classification and its intake audit.
    -- Called here so all of that plus the queue closure commit or roll back
    -- together.
    v_observation_id := public.approve_submitted_sale(
      p_edition_id => v_outcome.edition_id,
      p_source_id => v_outcome.source_id,
      p_source_listing_url => v_outcome.source_listing_url,
      p_external_id => v_legacy,
      p_listing_title => v_outcome.listing_title,
      p_sold_date => (v_outcome.sold_at at time zone 'UTC')::date,
      p_sale_price => v_outcome.sold_price,
      p_currency => v_outcome.sold_currency,
      p_shipping_price => null,
      p_quantity => 1,
      p_sale_type => p_sale_type,
      p_grading_company => p_grading_company,
      p_grade_label => p_grade_label,
      -- Printing is a separate human judgement with its own evidence bar. It
      -- is never inferred from a listing title here.
      p_print_classification => 'printing_not_identified',
      p_printing_proof_url => null,
      p_known_printing_number => null,
      p_price_corroboration_url => p_price_corroboration_url,
      p_submitted_payload => coalesce(p_submitted_payload, '{}'::jsonb),
      p_detector_output => coalesce(p_detector_output, '{}'::jsonb),
      p_decision_notes => coalesce(v_notes, 'Confirmed from watched eBay listing ' || v_outcome.external_id || '.'),
      p_reviewed_by => v_reviewer
    );
  end if;

  if v_observation_id is null then
    raise exception 'The sale could not be saved. Nothing was verified.';
  end if;

  -- The conditional columns are redundant under the lock taken above and are
  -- kept deliberately: if this function is ever called from a context that
  -- does not hold that lock, the write still refuses rather than clobbering.
  update public.listing_outcomes
     set status = 'review_complete',
         resulting_observation_id = v_observation_id,
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         review_notes = v_notes,
         next_check_at = null,
         updated_at = now()
   where id = v_outcome.id
     and reviewed_by is null
     and resulting_observation_id is null;

  if not found then
    raise exception 'This listing changed while the decision was being saved. Refresh and retry; nothing was verified.';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'review_complete',
    'observationId', v_observation_id,
    'reused', v_reused,
    'alreadyClosed', false
  );
end;
$$;

revoke all on function public.confirm_outcome_sale(uuid, text, text, text, text, text, jsonb, jsonb, text, text) from public;
grant execute on function public.confirm_outcome_sale(uuid, text, text, text, text, text, jsonb, jsonb, text, text) to service_role;

comment on function public.confirm_outcome_sale(uuid, text, text, text, text, text, jsonb, jsonb, text, text) is
  'Locks one listing_outcome, checks its completed-sale evidence, creates or reuses exactly one verified observation through approve_submitted_sale, and closes the watch queue -- all in one transaction. Idempotent on retry. Never verifies on a human''s behalf and never overwrites an existing human decision.';

notify pgrst, 'reload schema';
