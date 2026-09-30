# Cron recovery checkpoint — 30 September 2026

Read `AGENTS.md`, `cron-not-firing-handoff.md` (commit `12013c9`), then this checkpoint. This is an addition to the active beta checklist, not a replacement for the evidence rules or the original cron investigation.

## Verified locally

- Work resumed from `12013c9` on `codex/rar-beta-reliability`. Local `main` and cached remote refs do not establish the current production release. The earlier checkpoint's “main has not advanced” and “not deployed” statements are historical, not a fresh production check.
- The five schedules in `vercel.json` match the handoff. Staff proxy matchers do not include these cron routes. No schedule, secret, queue size or evidence policy was changed.
- A separate reporting defect exists: `runOutcomeChecks` can return `budgetUnavailable` without throwing, while its route previously returned `ok: true`. It now returns HTTP 503/`ok: false` for that case, 207 for other reported partial errors. This does **not** explain an absence of invocations.
- Every authenticated cron now records a start before work and a finish with bounded operational counts. A portfolio check with zero created rows and one skipped row is visibly completed, not missing. Partial failures and failed reliability gates are distinguishable from successful execution.
- A killed process leaves `started`; this means completion is unknown, not proof that no work happened. Audit-storage failure does not stop existing jobs. Writes have a three-second timeout; structured logs and `X-RAR-Cron-Recorded: false` identify lost durable telemetry. `X-RAR-Cron-Run` correlates responses/logs with rows. No request headers, URLs with secrets, raw error messages, holder IDs or evidence payloads are copied into heartbeat storage.
- Unauthorized requests remain rejected before audit/work. Heartbeats observe already-authorized invocations; they do not bypass authorization or make Vercel deliver requests.

## Deployment and live evidence — unresolved

No production access, credential inspection, migration application, manual cron execution or fresh data recount was performed in this resumption. Read-only production access was requested because the original review restricted access to local files; no response had arrived when this checkpoint was prepared. Do not retry the stale local CRON_SECRET or rotate secrets to bypass this constraint.

The handoff's 994 overdue outcomes and last-effect dates are historical observations. Recount before sizing or claiming recovery. Neither redeploy `d06da5a`'s effect nor the current migration/release state is established here. Do not assume either that the two earlier migrations are missing or that Claude has applied them.

New additive migration: `supabase/migrations/20260930_cron_invocations.sql`. **Not applied live.** RLS enabled; only service_role may read/insert/update. No public policies. Apply through the prescribed SQL-editor workflow before deploying this code, and verify the two earlier prerequisites without invoking their mutation RPCs:

```sql
select to_regprocedure('public.close_agent_action(uuid,text,text)') as closure,
       to_regprocedure('public.reserve_outcome_checks(uuid,integer)') as reserve,
       to_regprocedure('public.settle_outcome_checks(uuid,integer)') as settle,
       to_regclass('public.cron_invocations') as heartbeats;
```

The first three signatures only establish existence; inspect definitions, grants and RLS against the migrations too. The new migration does not repair or replace those prerequisites.

After applying and deploying, this read-only query shows each job's latest invocation, including jobs with no row:

```sql
with routes(route) as (values
  ('/api/cron/ebay-scout'), ('/api/cron/portfolio-snapshots'),
  ('/api/cron/rar-agents'), ('/api/cron/agent-reliability'),
  ('/api/cron/listing-outcomes')
)
select r.route, i.started_at, i.finished_at, i.status, i.http_status, i.summary, i.commit_sha
from routes r left join lateral (
  select * from public.cron_invocations c
  where c.route = r.route and c.environment = 'production'
  order by started_at desc limit 1
) i on true order by r.route;
```

No heartbeat alone is not proof of a scheduler fault: verify deployed instrumentation and storage health, then compare invocation logs during the schedule window. Environment and commit come from Vercel's system variables; inspect `unknown` separately if those are unavailable, never mistake preview/local work for production recovery. Start without finish means incomplete/unknown completion. Completed with zero work can be legitimate. Budget unavailable means check the prerequisite RPC and its access, not the schedule. Reliability gate failures are benchmark results, not observed production evidence loss.

## Exact next steps

1. With authorized read-only production access, identify the deployed commit and check whether the post-redeploy scheduled invocations occurred. Inspect migration prerequisites; recount the eligible outcome backlog with every predicate and a timestamp. Preserve Claude's already-recorded exclusions rather than repeating his investigation wholesale.
2. Apply the new migration and deploy only through the authorized deployment workflow. Capture both structured invocation logs and durable rows for the two affected schedules. Do not trigger genuine evidence mutations as tests. Do not infer that a branch push deploys production.
3. If scheduled/manual platform delivery still produces no invocation, prepare a Vercel support case with deployment ID, UTC schedule/window, affected routes, Run-button timestamps and observed logs. Sending it requires SP's authorization. Do not claim a confirmed platform cause before checking these facts.
4. Resume the existing desktop/phone staff checks and collector journey after release verification. Concurrency tests remain excluded at SP's request; Scout experiments remain in shadow. The original evidence and explicit human-verification rules still apply in full.

## Local validation / resume state

47 workflow scripts passed, including the new heartbeat tests: lifecycle order, unchanged/no-op success, partial failures, audit outages, secret-safe telemetry, actual route authorization and budget-failure response, and single-session schema/RLS/permission checks. Direct TypeScript check passed. Full lint passed with the two existing EditionCover image warnings. The initial build failed fetching Google Fonts in the sandbox; the network-enabled production build passed (37 static pages). After adding deployment metadata, the heartbeat tests and targeted lint passed again; the final build includes its own TypeScript check. No two-connection tests were run.

Changes are restricted to the five cron routes, `lib/cronHeartbeat.ts`, the additive migration, its test, the workflow test command and checkpoint documentation. Preserve unrelated `.claude/settings.local.json`. Commit this tranche separately and immediately push the current branch; locate the final commit with `git log -1` when resuming. This is an observability/reporting repair, **not a verified cron recovery or beta sign-off**.
