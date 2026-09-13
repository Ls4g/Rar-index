-- Durable agent action execution and recovery --------------------------------
--
-- Additive only: new nullable columns on agent_actions, three new functions,
-- one new index. No existing column, constraint, function, trigger or row is
-- altered or dropped. The status check constraint is untouched, so every
-- existing status keeps its exact meaning.
--
-- What the audit found, and what it actually was.
--
-- 23 approved actions had been sitting open, the oldest for 540 hours. Every
-- one of them shows the same event trail -- `proposed -> approved` and nothing
-- after -- and every one has executed_at null. They split cleanly in two, and
-- the two halves are broken for opposite reasons:
--
--   6 are machine-executable (scan_stale_profiles, shadow_test_*). Approving
--     one WITHOUT running it was a one-way door: the execute path selects the
--     action `.eq(status, 'proposed')`, so once a human approved it the
--     action could never be run at all. It answers "this proposal was already
--     reviewed" for ever. Approving was the thing that locked it.
--
--   17 are human work -- review this queue, triage those leads, source those
--     covers. "Approved" for these means "yes, someone should do that", and
--     there was never a step that said it had been done. They could only
--     accumulate.
--
-- Underneath both is one confusion: `status` was carrying two different
-- questions at once. Does a human agree this should happen, and has the work
-- happened? Those have different answers, different owners and different
-- failure modes, so they get different columns here.
--
-- `status` keeps its existing meaning exactly: the human approval decision.
-- `execution_status` is new and answers only whether the work has run.
--
-- The lease is what makes a crash recoverable. A worker claims an action for a
-- bounded time; if it finishes, it says so; if it dies, the lease expires and
-- the action becomes claimable again with its attempt count intact. An expired
-- lease NEVER becomes "succeeded" -- uncertain work is returned for a retry,
-- never quietly marked done.

alter table public.agent_actions
  add column if not exists execution_status text not null default 'not_started'
    check (execution_status in ('not_started', 'running', 'succeeded', 'failed')),
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists execution_attempts integer not null default 0,
  add column if not exists last_execution_error text,
  add column if not exists last_execution_at timestamptz;

comment on column public.agent_actions.execution_status is
  'Whether the work has run. Separate from status, which records only whether a human approved it. An action can be approved and never executed, which is the normal case for work a person does themselves.';
comment on column public.agent_actions.lease_expires_at is
  'When the current execution claim lapses. An expired lease returns the action to not_started so it can be retried; it is never promoted to succeeded.';

-- Finding claimable and stuck work without scanning the whole table.
create index if not exists agent_actions_execution_idx
  on public.agent_actions(execution_status, lease_expires_at);

-- Backfill. Actions already marked executed genuinely ran, so they are
-- recorded as succeeded and can never be replayed. Everything else keeps the
-- default not_started. No status, reviewer, timestamp or note is touched.
update public.agent_actions
   set execution_status = 'succeeded',
       last_execution_at = coalesce(executed_at, reviewed_at, created_at)
 where status = 'executed'
   and execution_status = 'not_started';

/**
 * Take a bounded claim on an approved action.
 *
 * Refuses anything a human has not approved, anything already succeeded, and
 * anything another worker currently holds. A lapsed lease is claimable: that
 * is the whole recovery path for a worker that crashed or timed out mid-run.
 */
create or replace function public.claim_agent_action(
  p_action_id uuid,
  p_owner text,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.agent_actions%rowtype;
  v_owner text := nullif(trim(coalesce(p_owner, '')), '');
  v_seconds integer := greatest(30, least(coalesce(p_lease_seconds, 300), 3600));
begin
  if v_owner is null then
    raise exception 'An execution claim needs an owner.';
  end if;

  select * into v_action from public.agent_actions where id = p_action_id for update;
  if not found then
    raise exception 'That agent action no longer exists.';
  end if;

  -- Approval is a human decision and this never makes it. An action that has
  -- not been approved cannot be claimed, whatever its execution state.
  if v_action.status not in ('approved', 'executed') then
    raise exception 'Only an approved action can be run. This one is "%".', v_action.status;
  end if;

  -- Completed side effects are never replayed.
  if v_action.execution_status = 'succeeded' then
    raise exception 'This action has already run. It was not run again.';
  end if;

  if v_action.execution_status = 'running'
     and v_action.lease_expires_at is not null
     and v_action.lease_expires_at > now() then
    raise exception 'Another worker (%) is running this action until %. Nothing was started.',
      coalesce(v_action.lease_owner, 'unknown'), to_char(v_action.lease_expires_at, 'HH24:MI:SS');
  end if;

  update public.agent_actions
     set execution_status = 'running',
         lease_owner = v_owner,
         lease_expires_at = now() + make_interval(secs => v_seconds),
         execution_attempts = execution_attempts + 1,
         last_execution_at = now(),
         last_execution_error = null
   where id = v_action.id;

  insert into public.agent_action_events (action_id, previous_status, next_status, actor, notes, details)
  values (v_action.id, v_action.status, 'execution_claimed', v_owner,
    case when v_action.execution_status = 'running' then 'Reclaimed after the previous lease lapsed.' else 'Execution claimed.' end,
    jsonb_build_object('attempt', v_action.execution_attempts + 1, 'lease_seconds', v_seconds,
      'reclaimed_from', case when v_action.execution_status = 'running' then v_action.lease_owner else null end));

  return jsonb_build_object(
    'ok', true, 'actionId', v_action.id, 'attempt', v_action.execution_attempts + 1,
    'actionType', v_action.action_type, 'reclaimed', v_action.execution_status = 'running'
  );
end;
$$;

/**
 * Close a claim the caller holds.
 *
 * Only the current lease owner may finish, so a worker that comes back after
 * its lease lapsed and was reclaimed cannot overwrite whoever took it over.
 * The approval identity, its timestamp and its notes are never rewritten --
 * only the execution columns and, on success, executed_at.
 */
create or replace function public.finish_agent_action(
  p_action_id uuid,
  p_owner text,
  p_succeeded boolean,
  p_error text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.agent_actions%rowtype;
  v_owner text := nullif(trim(coalesce(p_owner, '')), '');
  v_error text := nullif(trim(coalesce(p_error, '')), '');
begin
  if v_owner is null then raise exception 'Finishing a run needs the owner that claimed it.'; end if;
  if p_succeeded is null then raise exception 'Say whether the run succeeded or failed.'; end if;
  if p_succeeded is not true and v_error is null then
    raise exception 'A failed run must record why, so the retry is informed.';
  end if;

  select * into v_action from public.agent_actions where id = p_action_id for update;
  if not found then raise exception 'That agent action no longer exists.'; end if;

  if v_action.execution_status = 'succeeded' then
    return jsonb_build_object('ok', true, 'actionId', v_action.id, 'executionStatus', 'succeeded', 'alreadyFinished', true);
  end if;
  if v_action.execution_status <> 'running' then
    raise exception 'This action is not currently running, so there is no run to finish.';
  end if;
  if v_action.lease_owner is distinct from v_owner then
    raise exception 'This run is owned by %, not %. Nothing was changed.', coalesce(v_action.lease_owner, 'nobody'), v_owner;
  end if;

  update public.agent_actions
     set execution_status = case when p_succeeded then 'succeeded' else 'failed' end,
         lease_owner = null,
         lease_expires_at = null,
         last_execution_error = v_error,
         last_execution_at = now(),
         -- The approval axis only advances on success. A failure leaves the
         -- action approved and retryable rather than closing it.
         status = case when p_succeeded then 'executed' else v_action.status end,
         executed_at = case when p_succeeded then now() else v_action.executed_at end
   where id = v_action.id
     and execution_status = 'running'
     and lease_owner = v_owner;

  if not found then
    raise exception 'The run was taken over while it was finishing. Nothing was changed.';
  end if;

  insert into public.agent_action_events (action_id, previous_status, next_status, actor, notes, details)
  values (v_action.id, v_action.status,
    case when p_succeeded then 'execution_succeeded' else 'execution_failed' end,
    v_owner, nullif(trim(coalesce(p_notes, '')), ''),
    jsonb_build_object('attempt', v_action.execution_attempts, 'error', v_error));

  return jsonb_build_object(
    'ok', true, 'actionId', v_action.id,
    'executionStatus', case when p_succeeded then 'succeeded' else 'failed' end,
    'alreadyFinished', false
  );
end;
$$;

/**
 * Return actions whose worker never came back.
 *
 * Deliberately sets them to 'failed', not 'not_started' and never 'succeeded'.
 * Failed is honest -- RAR does not know whether the work completed -- and it
 * is retryable, because claim_agent_action accepts a failed action. A staff
 * page can show the reason and offer the retry rather than the action
 * vanishing or silently looking done.
 */
create or replace function public.recover_expired_agent_action_leases()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recovered uuid[];
begin
  with expired as (
    select id from public.agent_actions
     where execution_status = 'running'
       and lease_expires_at is not null
       and lease_expires_at <= now()
     for update skip locked
  ), updated as (
    update public.agent_actions a
       set execution_status = 'failed',
           lease_owner = null,
           lease_expires_at = null,
           last_execution_error = concat('The worker did not report back before its lease expired at ',
             to_char(a.lease_expires_at, 'YYYY-MM-DD HH24:MI'), ' UTC. Whether the work completed is unknown; retry to be sure.')
      from expired
     where a.id = expired.id
     returning a.id
  )
  select coalesce(array_agg(id), '{}') into v_recovered from updated;

  if array_length(v_recovered, 1) > 0 then
    insert into public.agent_action_events (action_id, previous_status, next_status, actor, notes, details)
    select id, 'running', 'execution_lease_expired', 'RAR Agent System',
      'The lease expired without the worker reporting back. Returned for retry, not marked complete.',
      '{}'::jsonb
      from unnest(v_recovered) as id;
  end if;

  return jsonb_build_object('ok', true, 'recovered', coalesce(array_length(v_recovered, 1), 0), 'actionIds', to_jsonb(v_recovered));
end;
$$;

revoke all on function public.claim_agent_action(uuid, text, integer) from public;
revoke all on function public.finish_agent_action(uuid, text, boolean, text, text) from public;
revoke all on function public.recover_expired_agent_action_leases() from public;
grant execute on function public.claim_agent_action(uuid, text, integer) to service_role;
grant execute on function public.finish_agent_action(uuid, text, boolean, text, text) to service_role;
grant execute on function public.recover_expired_agent_action_leases() to service_role;

notify pgrst, 'reload schema';
