# Cron jobs not firing — handoff

Written 2026-09-30. Everything below was checked, not assumed; where something
is unverified it says so.

Production is Vercel (Hobby), project `rar-index` under `ls4gs-projects`.

## Symptom

Two of five Vercel cron jobs stopped executing. No code change explains it.

| Route | Schedule | Last effect | Status |
| --- | --- | --- | --- |
| `/api/cron/rar-agents` | `0 11 * * *` | 29 Sep 11:36 | working |
| `/api/cron/ebay-scout` | `0 9 * * *` | 29 Sep | working |
| `/api/cron/listing-outcomes` | `30 9 * * *` | **26 Sep 16:14** | **dead** |
| `/api/cron/agent-reliability` | `30 11 * * *` | **24 Sep 12:00** | **dead** |
| `/api/cron/portfolio-snapshots` | `30 6 * * *` | 14 Sep | **not broken** |

`portfolio-snapshots` is a red herring and should not be chased.
`createPortfolioSnapshot` returns `{ created: false }` when
`payloadsEqual(payload, latest)`, and the single holder's two holdings have had
no change and no new price observations since 14 September (16 arrived
catalogue-wide, none for those editions). Writing no row is the designed
outcome.

## What it is costing

- **994** `listing_outcomes` rows sit at `ended_pending_check` with
  `next_check_at` overdue since 22 September, untouched. Every one passes all
  the filters in `runOutcomeChecks`: unreviewed, no `resulting_observation_id`,
  `outcome_provider` is `RAR scheduler` rather than the excluded
  `eBay page — staff observed`. The work is real and nothing is doing it.
- Reliability evaluations have not run for six days.

## Ruled out — do not re-investigate

- **Crons are enabled.** Settings → Cron Jobs shows the toggle on and all five
  registered with the correct schedules.
- **`CRON_SECRET` is set for Production**, type Secret (write-only), **added
  2 August and never updated**. It cannot be a mismatch: it predates the period
  when these crons were working normally.
- **The routes are live.** An unauthenticated
  `GET https://rar-index.vercel.app/api/cron/listing-outcomes` returns a correct
  `401`, so the function is deployed and reachable.
- **Request logging works** — dozens of entries for other paths in the last 30
  minutes.
- **No invocation is logged for the dead routes at all**, including after
  pressing Vercel's own **Run** button twice. No log line, no database effect.
- **Usage is not throttling.** Fluid Active CPU 37m 12s / 4h, CDN requests
  70K / 1M, fast data transfer 246 MB / 100 GB, edge executions 0 / 500K. No
  warning banner.
- **Not a cron-count limit.** Vercel raised that to 100 per project on every
  plan in January 2026. Hobby's only constraints are once-per-day and a
  one-hour execution window, and all five schedules already comply.

## Already attempted, unverified

Empty commit `d06da5a` pushed to `main` to force a production redeploy, on the
grounds that cron schedules are registered from the production deployment.
**Whether it worked is unknown** — the test is whether the 09:30 and 11:30 runs
fire the following morning.

## Constraints on whoever picks this up

- Hobby caps **runtime log retention at one hour**. "Last 12 hours" and "Last
  day" are Pro-only; three days and beyond need Observability Plus. Scheduled
  runs therefore cannot be inspected after the fact, and anything diagnostic has
  to be captured at run time.
- The repository's local `.env.local` holds a **stale `CRON_SECRET`** that 401s
  against production (it also 401s against `rar-agents`, which demonstrably
  runs). The endpoints cannot be triggered by hand from that machine. The Vercel
  value is write-only and cannot be read back, so testing by hand requires
  rotating it in both places.

## Suggested direction

1. Check whether `d06da5a` re-registered the schedules.
2. If it did not, this is a Vercel-side fault rather than a repository one. A
   Run button that produces no invocation and no log entry is not normal, and
   the evidence above is a clean support case.
3. Independent of the cause: **the crons record their effects but never record
   that they ran.** "No rows written" is ambiguous between *ran and had nothing
   to do* and *never ran*. That ambiguity is why this went unnoticed for days,
   and why `portfolio-snapshots` was first misread as broken here. A heartbeat
   row per invocation — route, started, finished, what it did — would make the
   difference visible at a glance and is worth more than the fix itself.
