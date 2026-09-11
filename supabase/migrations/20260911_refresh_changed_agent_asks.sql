-- A reviewed approval is immutable audit history, not a permanently open
-- proposal. Keep only one *proposed* row per work identity so a materially
-- changed ask can be raised without rewriting the human's earlier decision.
drop index if exists public.agent_actions_open_dedupe_idx;

create unique index agent_actions_open_dedupe_idx
  on public.agent_actions(dedupe_key)
  where status = 'proposed';
