-- These two views contain staff review details/counts. Every repository caller
-- uses getSupabaseAdmin(); Supabase authenticated is a collector, not staff.
begin;
alter view public.price_review_queue set (security_invoker = true);
alter view public.edition_readiness set (security_invoker = true);
revoke all on table public.price_review_queue, public.edition_readiness from public, anon, authenticated;
grant select on table public.price_review_queue, public.edition_readiness to service_role;

-- Reviewed public projections deliberately cross private-table RLS:
-- alpha_catalogue_v1: verified catalogue identity plus aggregate evidence counts;
-- publication_print_readiness: publication-level verified print evidence counts;
-- publication_availability: aggregate Scout observations, never sale evidence;
-- public_shelf_editions: only opted-in username/username_key/edition_id, never
-- purchase fields. Invoker mode would hide shelves; wider holdings RLS would
-- expose private purchase data. Preserve their narrow owner-rights contracts.
-- The security-definer-view advisor findings for these four remain intentional.
alter view public.alpha_catalogue_v1 set (security_barrier = true);
alter view public.publication_print_readiness set (security_barrier = true);
alter view public.publication_availability set (security_barrier = true);
alter view public.public_shelf_editions set (security_barrier = true);
revoke all on table public.alpha_catalogue_v1, public.publication_print_readiness,
  public.publication_availability, public.public_shelf_editions from public, anon, authenticated;
grant select on table public.alpha_catalogue_v1, public.publication_print_readiness,
  public.publication_availability, public.public_shelf_editions to anon, authenticated, service_role;
notify pgrst, 'reload schema';
commit;
