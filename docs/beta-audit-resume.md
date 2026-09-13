# Beta audit resume — second repair tranche

Baseline for this tranche: main at `4ef7c9a`. Earlier tranche: `326ad78`, `bdbdd70`, checkpoint `4ef7c9a`. Everything below supersedes the previous status.

## Shipped and pushed

| Commit | What |
| --- | --- |
| `4f174b5` | Atomic outcome-to-sale completion: migration + PGlite atomicity test |
| `1f3fd15` | Grading correction workflow: migration + guard change + PGlite test |
| `2c3e4b4` | Durable agent execution: migration, lease tests, reconciliation script, cron recovery |
| `b07a116` | Scout junk reduction measured; rules left in shadow mode |

## Migration blocker resolved — applied 13 September 2026

Codex applied all three migrations below, in order, to RAR production project `fmzzersppzqevtwqvnbd` through the authenticated in-app Supabase SQL editor. Each ran in its own explicit transaction and returned success. Editor SQL was compared with the local migration using normalized-content length/checksum before execution (comments and formatting omitted; SQL statements unchanged).

Post-application checks confirmed five functions, three grading columns, six execution columns, all three indexes, grading audit RLS and append-only trigger, and completed-action backfill. All 23 approved actions remain approved/not_started. Observation `ff81fb2f-201d-4ef1-85db-74171ae76b2a` remains unchanged, and no grading decisions were created. No evidence verification or agent execution was performed.

**Additional security repair applied:** `20260913_beta_rpc_permissions.sql`. Live permission checks found that Supabase defaults had granted EXECUTE directly to `anon` and `authenticated`; revoking PUBLIC in the original migrations did not remove those grants. The additive permission migration explicitly revokes both roles on the five new RPCs. Rechecked live: service_role=true, anon=false, authenticated=false for all five.

The held application files below were not committed or deployed by this migration-application task. Claude can now complete the application validation/deployment gate. Do not reapply the migrations merely because the historical notes below describe the earlier blocker.

Application-time checks: lint passed with two existing EditionCover warnings, direct TypeScript check passed, and full production build passed against the current working tree. The workflow suites and two-session concurrency tests were not rerun in this application-only task.

### Historical blocker

The Supabase dashboard would not render in Chrome on this machine (page HTML loads, 94 scripts present, `#__next` present, React never mounts, no Monaco). Five attempts across three tabs. No Docker, no `psql`, no database password in `.env.local`, so there is no other route to DDL from here.

Apply in this order, then tell the agent so the held code can ship:

1. `supabase/migrations/20260913_atomic_outcome_sale_closure.sql`
2. `supabase/migrations/20260913_observation_grading_correction.sql`
3. `supabase/migrations/20260913_durable_agent_execution.sql`

All three are additive: new columns (nullable or defaulted), new tables, new functions, new indexes. Nothing existing is altered or dropped. Each has been executed end-to-end against real PostgreSQL 18.3 via PGlite.

## Held code — SHIPPED in `0185dfd`, deployed and verified

Nothing is held any more. The table below is kept as the record of what was waiting on which migration.

### Post-deployment verification, 13 September 2026

Read-only against production, nothing mutated:

- All three new column sets and the grading audit table are readable.
- All five functions are reachable by the server role and **refused for the public key** — the grant hole closed in `4be59d2` is genuinely shut.
- Lease recovery is currently a true no-op: no action is mid-run, and calling it recovered 0.
- The Decisions page grading query returns exactly one conflict, the known Hunter x Hunter slab.
- `ff81fb2f` untouched; no grading decisions exist; all 23 approved actions still approved/not_started; backfill marked all 74 executed actions succeeded.
- Deployed site live. `/api/observation-grading` answers 401 "Staff credentials are required" rather than 404, so the new route is in production.
- **The exclusion is visibly working on the live edition page.** Hunter x Hunter Volume 1 shows a median of £89.30 = US$120, the median of the five RAW sales. Pooling the US$2,000 slab would give ~£96. The graded copy is genuinely out of the raw comparison group in production.

Gate: full suite (36 scripts) exit 0, TypeScript clean, lint 0 errors with the two existing image warnings, production build passed with `/api/observation-grading` compiled.

**Still unverified:** the staff screens themselves. They sit behind a login whose password must not be typed into a form, so the grading card and the outcome confirmation form have not been seen rendering, on desktop or phone. Both need a human look.

### What was held, and why

Held because it reads columns or calls functions the migrations create. Deploying it before the migrations would break the pages listed.

| File | Needs | Breaks without it |
| --- | --- | --- |
| `lib/outcomeSaleConfirmation.ts` | `confirm_outcome_sale` | Sale confirmation refuses with a clear message (fail-safe, writes nothing) |
| `scripts/test-outcome-sale-confirmation.mjs` | same | Test asserts the new call contract |
| `app/review/page.tsx` | `grading_reviewed_at` | Decisions page query errors |
| `components/HumanDecisionInbox.tsx` | same | Grading conflict card |
| `components/PortfolioClient.tsx`, `lib/portfolioSnapshot.ts`, `app/edition/[id]/page.tsx` | same | Portfolio and edition queries error |
| `app/api/observation-grading/` (untracked) | `record_observation_grading` | New route, returns 503 until applied |
| `app/globals.css` | — | Styling for the grading fields |
| `app/api/agents/route.ts` | `claim_agent_action` / `finish_agent_action` | Agent execution claims |

All of the above shipped in `0185dfd`.

## Live read-only baseline, 13 September 2026 11:27 UTC

- Approved actions still open: **23** (unchanged). 6 machine-executable, 17 human work.
- Outcomes: 699 active, 951 ended_pending_check, 110 unsold, 17 ambiguous, 8 sold_candidate, 23 review_complete, 4 inaccessible. Nine outcome-origin sales.
- `ff81fb2f-201d-4ef1-85db-74171ae76b2a` still has empty grading fields, `verified_match`, USD 2000. Confirmed read-only. **No grade was inferred or written.**
- Scout benchmark now **822** cases (was 811): recall 571/578 = 98.79%, junk rejection 46/244 = 18.85%.
- 4 of the last 140 agent runs did not succeed.
- Total observations 66, verified 61. Exactly one grading conflict exists.

## Validation completed

- `test-outcome-sale-atomicity.mjs` — 59 checks, PGlite, shipped migration SQL. Real rollback, idempotent retry, refusal paths.
- `test-observation-grading.mjs` — 33 checks, PGlite. Production title verbatim, append-only enforcement.
- `test-agent-execution-leases.mjs` — 48 checks, PGlite. Lease ownership, crash recovery, idempotent finish, backfill.
- `test-scout-junk-rules.mjs` — real reviewed titles, both directions.
- Full workflow suite (36 scripts) exit 0. TypeScript clean. Lint 0 errors, 2 pre-existing `EditionCover` `<img>` warnings. Production build passed.

**Not established:** two genuinely simultaneous database connections. PGlite runs a single backend, so `for update` blocking a second session cannot be observed here. Needs Docker or a real server.

**Not performed:** any live database mutation, any staff-UI end-to-end test, any phone check. No credentials entered, no fake evidence created.

## Next — all of these need a person, not another migration

1. **Look at the two staff screens.** The grading card on `/review` and the outcome confirmation form on `/listing-outcomes` have never been seen rendering, on desktop or phone. This is the only remaining unknown in the work that shipped.
2. **Resolve `ff81fb2f`.** Open its eBay listing and record raw or graded on the Decisions page. Its five raw siblings are unaffected either way; the slab is currently held out of raw comparisons and the live page confirms it.
3. **Work the 23 open approvals.** `node --experimental-strip-types --env-file=.env.local scripts/reconcile-open-agent-actions.mjs` gives a verdict per action: 1 to run, 1 already clear, 7 genuinely live, 14 needing a judgement.
4. **Decide on graded leads.** `graded_slab` would cut Scout junk by roughly half but costs real buying opportunities. It needs its own queue rather than activation.
5. **Investigate the 4 failed agent runs** out of the last 140.
6. **Still unaudited:** `/agents`, `/scout`, `/catalogue-review`, `/cover-review`, `/add-sale`, public collection and mobile workflows.

Concurrency under two simultaneous connections remains untested — PGlite is a single backend and this machine has no Docker.
