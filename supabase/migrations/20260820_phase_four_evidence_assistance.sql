-- RAR autonomy, phase 4: assisted evidence review.
--
-- Evidence Auditor may prepare non-authoritative suggestions from an explicit
-- marketplace printing claim plus a captured copyright-page image. It still
-- has no route to update price_observations: only the existing staff review
-- RPC can classify a sold copy, and that RPC keeps its normal human audit row.

update public.agent_system_control
set autonomy_level = greatest(autonomy_level, 4),
    updated_by = 'Phase 4 evidence assistance migration'
where singleton = true;

update public.agent_controls
set mode = 'prepare',
    mission = 'Prepare cautious printing-evidence suggestions for staff; never classify or verify a sale.',
    schedule_label = 'Daily preparation',
    updated_by = 'Phase 4 evidence assistance migration'
where agent_key = 'evidence_auditor';

comment on table public.agent_actions is
  'Auditable agent proposals and completed safe actions. Evidence Auditor suggestions never mutate price observations without a separate human review decision.';
