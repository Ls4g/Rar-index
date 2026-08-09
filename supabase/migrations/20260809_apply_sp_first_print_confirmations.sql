-- RAR owner confirmation policy ------------------------------------------------
--
-- SP is the project owner and the human reviewer responsible for the legacy
-- first-print inspections recorded before the publication -> print-run model
-- was introduced. Those completed, exact-edition sales were deliberately left
-- as `printing_not_identified` by the conservative migration because their
-- individual inspection URLs had not been copied into the new field.
--
-- The owner has now explicitly confirmed that every completed, exact-edition
-- sale reviewed by SP is a first-print sale. Preserve the original completed
-- listing URL as the inspection source, set the known printing number to one,
-- and use the existing audited function for every change. This does not touch
-- Scout leads, active listings, unreviewed records, or sales without a source.
--
-- The `not exists` guard makes this safe to run again: each eligible sale gets
-- one owner-confirmation classification decision from this migration.

do $$
declare
  sale record;
begin
  for sale in
    select po.id, po.source_listing_url
    from public.price_observations po
    where po.sale_status = 'confirmed'
      and po.match_status = 'verified_match'
      and po.print_classification <> 'first_print_proven'
      and nullif(trim(po.source_listing_url), '') is not null
      and exists (
        select 1
        from public.price_review_decisions review
        where review.observation_id = po.id
          and lower(trim(review.reviewed_by)) = 'sp'
      )
      and not exists (
        select 1
        from public.price_print_classification_decisions classification
        where classification.observation_id = po.id
          and classification.classification = 'first_print_proven'
          and lower(trim(classification.reviewed_by)) = 'sp'
      )
  loop
    perform public.apply_price_print_classification(
      sale.id,
      'first_print_proven',
      sale.source_listing_url,
      1,
      'SP owner-confirmed first-print classification. The original completed listing remains the inspection source for this legacy review.',
      'SP'
    );
  end loop;
end;
$$;
