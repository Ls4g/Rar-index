-- A human who has already said "keep watching" should not be asked the same
-- unresolved question every time the provider remains inconclusive. Monitoring
-- continues normally; this column controls only when the listing may return to
-- the Decisions inbox. A sold_candidate always bypasses the cooldown in app
-- code so a real sale is never hidden.
alter table public.listing_outcomes
  add column if not exists human_attention_snoozed_until timestamptz;

comment on column public.listing_outcomes.human_attention_snoozed_until is
  'Do not repeat an unresolved human outcome question before this time. Automated checks continue and sold candidates bypass the cooldown.';

create index if not exists listing_outcomes_human_attention_snooze_idx
  on public.listing_outcomes (human_attention_snoozed_until)
  where reviewed_by is null
    and resulting_observation_id is null
    and human_attention_snoozed_until is not null;

-- Respect earlier Keep watching decisions immediately. The latest human
-- decision wins, and an old decision whose two weeks already elapsed remains
-- eligible for a fresh question.
with latest_keep_watching as (
  select
    outcome_id,
    max(checked_at) as checked_at
  from public.listing_outcome_checks
  where raw_response ->> 'decision' = 'keep_watching'
  group by outcome_id
)
update public.listing_outcomes outcome
set human_attention_snoozed_until = latest.checked_at + interval '14 days'
from latest_keep_watching latest
where outcome.id = latest.outcome_id
  and outcome.reviewed_by is null
  and outcome.resulting_observation_id is null
  and outcome.status in ('active', 'ended_pending_check', 'ambiguous', 'inaccessible')
  and (
    outcome.human_attention_snoozed_until is null
    or outcome.human_attention_snoozed_until < latest.checked_at + interval '14 days'
  );
