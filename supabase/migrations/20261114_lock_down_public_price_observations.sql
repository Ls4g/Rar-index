-- Public read access to sales evidence: only the confirmed sales the public
-- pages show, and only the columns they use.
--
-- Before this, the policy "Public can read price observations" was
-- `using (true)` and anon/authenticated held every table privilege, so anyone
-- holding the public (anon) key could read every row and every column through
-- the REST API, including raw_payload (the scraped listing, seller details
-- included), notes, reviewer names and grading review notes. RLS had no write
-- policy, so writes were already refused; the write grants are removed too so
-- that stays true even if a write policy is added later by mistake.
--
-- Public readers (all use the anon client), and what they select/filter on:
--   app/edition/[id]/page.tsx, components/ConceptExperience.tsx,
--   app/collectors/[username]/page.tsx, app/design-concept/collector/page.tsx,
--   components/PortfolioClient.tsx
-- Every one filters sale_status = 'confirmed' and excludes excluded matches,
-- so the row rule below changes nothing they show. Staff pages, crons and
-- the review tools use the service-role client, which bypasses RLS and these
-- grants, so they are unaffected.
--
-- Not destructive: no data, column or table is changed. Reversible with
--   alter policy "Public can read price observations" on public.price_observations using (true);
--   grant select on public.price_observations to anon, authenticated;

begin;

alter policy "Public can read price observations" on public.price_observations
  using (sale_status = 'confirmed' and match_status is distinct from 'excluded');

revoke all on public.price_observations from anon, authenticated;

grant select (
  id, edition_id, source_id, source_listing_url, listing_title, sold_date,
  sale_price, currency, grading_company, grade_label, grading_reviewed_at,
  match_status, sale_status, print_classification, printing_proof_url,
  known_printing_number
) on public.price_observations to anon, authenticated;

commit;
