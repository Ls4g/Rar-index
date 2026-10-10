-- Close under the same row lock used by claim/finish, including its audit.
create or replace function public.close_agent_action(
  p_action_id uuid, p_reviewer text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_action public.agent_actions%rowtype;
  v_reviewer text := nullif(trim(p_reviewer), '');
  v_reason text := nullif(trim(p_reason), '');
begin
  if v_reviewer is null or v_reason is null or length(v_reason) < 3 then
    raise exception 'A reviewer and a reason of at least three characters are required.';
  end if;
  select * into v_action from public.agent_actions where id = p_action_id for update;
  if not found or v_action.status <> 'approved' then
    raise exception 'That action is not an open approval. Refresh the list.';
  end if;
  -- Recovery must settle an expired claim before staff closes it too. This
  -- prevents a late worker finishing an action staff has already closed.
  if v_action.execution_status = 'running' then
    raise exception 'This action has an execution claim. Finish or recover it before closing.';
  end if;
  update public.agent_actions set status = 'cancelled',
    review_notes = concat_ws(' · ', nullif(v_action.review_notes, ''), 'Closed by ' || v_reviewer || ': ' || v_reason)
  where id = p_action_id;
  insert into public.agent_action_events(action_id, previous_status, next_status, actor, notes, details)
  values(p_action_id, 'approved', 'cancelled', v_reviewer, v_reason,
    jsonb_build_object('closed_without_executing', true, 'title', v_action.title));
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.close_agent_action(uuid,text,text) from public, anon, authenticated;
grant execute on function public.close_agent_action(uuid,text,text) to service_role;
