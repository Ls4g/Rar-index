-- Staff identity is an HMAC session checked by the application's server routes,
-- not Supabase Auth. Only that backend's service_role may call these workflows.
-- Public report/request forms also call their rate-limit RPC through the backend.
-- No evidence, review decision, rule activation or function body changes here.
begin;

do $permissions$
declare
  routine record;
begin
  -- Include every overload: an old signature must not retain a bypass. Names
  -- are explicitly scoped to RAR; unrelated/extension functions are untouched.
  -- Absent newer RPCs are allowed so this security fix can precede deployment
  -- of pending feature migrations (which already carry explicit permissions).
  for routine in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname = any (array[
      'apply_price_review', 'apply_catalogue_review',
      'apply_community_report_decision', 'apply_catalogue_request_decision',
      'register_community_report_submission', 'register_catalogue_request_submission',
      'apply_scout_lead_decision', 'apply_scout_lead_decision_with_label',
      'update_marketplace_search_profile', 'apply_cover_review',
      'apply_cover_candidate_decision', 'apply_price_print_classification',
      'apply_scout_agent_auto_dismiss', 'apply_scout_agent_availability_results',
      'apply_historical_scout_label', 'activate_scout_rule_version',
      'rollback_scout_rule_version', 'finish_agent_cycle', 'resolve_agent_incident',
      'approve_submitted_sale', 'reject_submitted_sale', 'confirm_outcome_sale',
      'record_observation_grading', 'claim_agent_action', 'finish_agent_action',
      'recover_expired_agent_action_leases', 'close_agent_action',
      'reserve_outcome_checks', 'settle_outcome_checks',
      -- Trigger functions are not public RPCs. Revoking direct EXECUTE does not
      -- prevent already-installed triggers from enforcing their invariants.
      'enforce_print_run_depth', 'prevent_portfolio_snapshot_update',
      'reject_reserved_collector_username', 'record_agent_action_event',
      'touch_agent_control_updated_at', 'block_scout_rule_audit_mutation',
      'record_scout_rule_event', 'touch_agent_incident_updated_at',
      'record_agent_incident_event', 'block_agent_incident_event_mutation',
      'block_agent_reliability_mutation'
    ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', routine.signature);
    execute format('grant execute on function %s to service_role', routine.signature);
  end loop;
end;
$permissions$;

-- PostgreSQL's global PUBLIC default and Supabase's explicit schema defaults
-- both matter. Future postgres-created RPCs require an intentional grant.
-- This does not revoke any existing unrelated function's permissions.
alter default privileges for role postgres revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

notify pgrst, 'reload schema';
commit;
