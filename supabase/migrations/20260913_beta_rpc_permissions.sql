-- Supabase default privileges explicitly grant new functions to anon and
-- authenticated. Revoking PUBLIC alone does not remove those direct grants.
-- These five staff mutation RPCs must only be callable by the server role.
begin;
revoke all on function public.confirm_outcome_sale(uuid, text, text, text, text, text, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.record_observation_grading(uuid, text, text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.claim_agent_action(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finish_agent_action(uuid, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.recover_expired_agent_action_leases() from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
