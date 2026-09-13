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

## Third tranche — two inbox dead ends, 13 September 2026 (`e2bb0a4`)

Both reported from a phone, both now fixed, pushed and deployed.

**The slab is resolved.** `ff81fb2f` now reads BGS 8.5, `grading_reviewed_by` SP, `grading_reviewed_at` 13 Sep 17:39 UTC. The human confirmed the grade was correct. Item 2 of the old Next list is done; no further action.

**Staff screens do render on mobile.** A phone screenshot of `/review` shows the catalogue card and the outcome card laid out correctly. The *grading* card still has not been seen.

| Bug | Root cause | Fix |
| --- | --- | --- |
| A correct edition could not be added | The inbox offered one-click `Yes — add edition` for every `edition_candidate`, but the API refuses `approve_new` without a language, and the Curator deliberately leaves language blank when the source did not state one. Yowamushi Pedal Vol. 2 (`d20f7e7a`, ISBN 9780316354684, Yen Press) is exactly that. Guards themselves were fine — both returned null. | `catalogueOneClickApprovalBlocker()` in `lib/catalogueApprovalGuard.ts` runs the API's own preconditions plus both existing guards. Blocked candidates show the reason and link to `/catalogue-review#candidate-<id>`, which already asks for the language rather than guessing. |
| A linked sale was missing on `/listing-outcomes` | The attention query caps at 200 while **949** listings qualify, so a linked listing was usually outside every window, and the panel's `rows.find` matched nothing silently. | The page fetches the focused outcome by id and merges it in, deduplicated. |

`scripts/test-decision-handoff-live.mjs` — 12 checks, live read-only, needs `--env-file=.env.local`. Deliberately **not** in `test:workflows`, which must run without credentials. Asserts the real Yowamushi row is held back, a complete candidate still approves in one click, and a genuinely out-of-window listing becomes present without duplication.

Gate: full suite (36 scripts) exit 0, TypeScript clean, lint 0 errors with the two existing `EditionCover` warnings, production build passed. Site live, `/listing-outcomes` correctly 307s to login.

**Not fixed, deliberately:** 749 attention listings remain unreachable through the page's own filters. The by-id fetch repairs the *link*, not the browsing cap. Paginating that queue is its own piece of work.

## Phase 1 — every outcome reachable, staff workflows verified (13 September 2026)

Supersedes the "749 inaccessible attention listings" note below, which was both stale and an undercount.

### Fresh counts, read 2026-09-13T21:26Z from project `fmzzersppzqevtwqvnbd`

Denominator: **1812** `listing_outcomes` rows. By status: `ended_pending_check` 933, `active` 716, `unsold` 110, `review_complete` 32, `ambiguous` 17, `inaccessible` 4, `sold_candidate` **0** (was 8; all resolved).

The page's SQL attention filter (four statuses, `reviewed_by IS NULL`) matches **948**. That is *not* the review queue: `outcomeView` sends an `ended_pending_check` row with `check_attempts = 0` to "watching", because RAR has not looked at it and has no question to ask. Classified honestly:

| Tab | Rows | Pages of 25 |
| --- | --- | --- |
| Needs review | **545** | 22 |
| Still watching | **1119** | 45 |
| Finished | **148** | 6 |

Review queue by queue: worth_checking 204, best_offer 204, high_value 96, graded 15, lot 10, conflict 1, parked 341.

### What was actually broken

The page capped three queries at 200/75/25 rows and derived its tab and queue counts from that sample. So **1506 of 1812 rows could not be opened at all** (748 review + 641 watching + 117 finished), and every count staff read was a floor presented as a total. Of the 545 review-queue listings, **421 sat outside the old 200-row window.**

### What replaced it

`lib/outcomeBrowsing.ts` classifies and counts the whole table server-side, then serves one page. Queue filters stay in TypeScript because they depend on title patterns and match scores that are not SQL-expressible — reimplementing them in SQL would have forked the rules. The page now:

- reads every row through `.range()` paging, because PostgREST caps a response at 1000 and a single select silently returned a partial table;
- loads full detail and check history for the served page only — page 1 costs 25 detail rows and 83 check rows, where the old page sent ~2.6MB if it had loaded everything and in practice sent ~678KB;
- keeps `view`, `queue`, `sort`, `q` and `page` in the URL, so a filtered queue is linkable and pagination composes with filters instead of filtering one page and calling it a total;
- sorts with an explicit tiebreak on id, so a page boundary between equal sort keys cannot repeat or skip a row;
- still fetches a linked outcome by id, and now serves the tab, queue **and page** that contain it.

### Evidence

- `scripts/test-outcome-browsing.mjs` — 79 checks, no credentials, in `test:workflows`. Full traversal of every view/queue/sort over a 391-row synthetic set with deliberate sort-key ties; boundaries, clamping, empty sets, page size 1, focus outside the page, cross-tab focus, missing focus, search, queue-count partitioning, parameter validation.
- `scripts/test-outcome-browsing-live.mjs` — 24 checks, live read-only. Range paging reads all 1812 rows; traversal of all ten view/queue combinations reaches every row exactly once; 25 sampled previously-unreachable listings are all now served; the last row in the order is reachable.
- `scripts/verify-staff-pages-live.mjs` — 71 checks against a local dev server over HTTP. All seven staff pages gated anonymously and rendering with a session; `/` and `/collection` public and free of staff controls; page 1/2/last/beyond-end ranges; nonsense query parameters falling back; served HTML agreeing with the library about which listings are on which page; three real deep links opening their listing; a dead link explaining itself; empty search state.
- `scripts/report-outcome-coverage.mjs` — the count report above, re-runnable.

Session cookies for the HTTP checks are minted with the repository's own `createStaffSession` against credentials created for the check. No password was typed into a form and no production credential was used.

### Browser evidence, desktop and mobile

Real Chrome against local dev, production data, read-only. Desktop 1920px: 25 cards, "Showing 1–25 of 204 listings", "Page 1 of 9", First/Previous correctly disabled, tabs 545/1119/148. Mobile 390px via the iframe technique in AGENTS.md: media query matches, **zero** overflowing elements, no horizontal page scroll, pager renders as an even 2×2 grid of 160×46px targets, and clicking Next genuinely moved to "Showing 26–50 of 204 / Page 2 of 9".

### Defects found and repaired

1. **Public homepage, mobile — 5 of 8 cover links unreachable.** `.home-discovery-rail` carried `overflow: hidden` in a `max-width: 760px` block that came *after* another block setting `overflow-x: auto` for the same breakpoint, so the later rule won. The shelf is ~1050px of 8 `<a>` covers under "Find the next volume you'll love"; at 390px only 2 were fully visible and 5 were clipped with no way to scroll to them. Now `overflow-x: auto` with `overscroll-behavior-x: contain`; verified the last cover is reachable and the page still has no horizontal scroll. The rule was duplicated in the file and both copies were fixed.
2. **Grading card asserted a human confirmation that was never asked for.** `/api/observation-grading` deliberately refuses a correction unless `sourceConfirmed === true` — "Confirm that you opened the original listing" — and the card satisfied that check by hardcoding `sourceConfirmed: true`. The gate was vacuous from the only UI that calls it, and the audit trail recorded that a person had opened the listing when nothing had ever asked them. There is now a required checkbox; both decision buttons stay disabled until it is ticked.
3. Pager and search-row raggedness at 390px (uneven 41/46px buttons, a three-item row wrapping badly) — both now uniform.

Inspected and accepted: `/agents` renders a 840px table inside a `overflow-x: auto` wrapper at 322px, which is the correct pattern. `article.home-spotlight` clips `.home-spotlight-sketch` and `.home-book-depth` at 390px — decorative only, no text, link or control is lost.

### Grading card verified on an isolated fixture

The card only appears when a verified sale's grading contradicts itself, and the single production conflict is now resolved — so it was unverifiable without either fabricating a conflict on real evidence, which is forbidden, or a fixture. `app/dev/grading-fixture/page.tsx` renders the **real** component with a fixture observation id that belongs to nothing, and 404s outside development.

Exercised in Chrome against the real route and real RPC: both buttons disabled until the source confirmation is ticked; ticking enables them; the graded path with no company or grade returns "Enter both the grading company and the exact grade shown on the slab."; with BGS/8.5 supplied, saving reaches the API and the RPC and returns its own guard, "That sale no longer exists."; the raw path returns the same; the card survives the error with both buttons re-enabled, so a retry is possible; unticking re-disables both. `scripts/test-observation-grading.mjs` (PGlite, shipped migration SQL) covers the handler's append-only audit, half-grade completion and refusal of an unknown sale.

**No production evidence was touched.** `ff81fb2f` still reads BGS 8.5, `grading_reviewed_at` 2026-09-13T17:39:08Z, re-read after the fixture work. No row exists for the fixture id.

### Gate

Full suite 80 scripts exit 0 (79 new pagination checks included), TypeScript clean, lint 0 errors with the two pre-existing `EditionCover` warnings, production build passed with `/dev/grading-fixture` compiled as a dynamic route.

### Remaining Phase 1 gaps

- **Authenticated rendering on a real phone is still unverified.** The 390px evidence above is a real browser at a real viewport, but it is an iframe on a desktop machine, not a handset: no touch scrolling, no mobile Safari or Chrome-on-Android engine, no on-screen keyboard. Checklist for a person, on a phone: (1) `/listing-outcomes` — swipe the pager to page 2 and back, confirm "Showing 26–50 of 204"; (2) tap a queue chip and confirm the count in the chip matches the range that loads; (3) type in "Find a listing" and submit, confirm the keyboard does not cover the Search button; (4) on `/` swipe the cover shelf and confirm all 8 covers can be reached; (5) `/dev/grading-fixture` on local dev only — confirm the confirmation checkbox is tappable and the buttons stay dead until it is ticked.
- Decision *writes* were never exercised against production from this session, by design. The confirm/dismiss/bulk paths are covered by the PGlite suites, not by a live mutation.

## Phase 2 — approvals reconciled, failures diagnosed, concurrency still blocked (13 September 2026)

Supersedes the "23 open approvals" and "4 of the last 140 agent runs" figures below.

### Open approvals: 26, not 23 — and 15 distinct jobs

Read 2026-09-13T21:59Z. `agent_actions` holds 104 rows: 76 `executed`, 26 `approved`, 2 `cancelled`. `execution_status` is `succeeded` on all 76 and `not_started` on the other 28, so nothing is stuck mid-execution and no lease is orphaned.

**11 of the 26 are older instances of a job that has since been approved again.** The planner re-proposes each recurring job every run, a person approves it, and the previous approval was never superseded:

| Job | Open approvals |
| --- | --- |
| `triage_scout_leads` | 4 (28 Aug, 11, 12, 13 Sep) |
| `source_missing_covers` | 3 |
| `review_catalogue_queue` | 3 |
| `shadow_test_multi_volume_detection`, `resolve_readiness_bottleneck`, `review_scout_feedback_conflicts`, `review_scout_feedback_precision`, `shadow_test_first_print_proof_gate` | 2 each |

**Root cause.** `approvalStillCoversProposal` compared the proposal's title to the open approval's title exactly. Planning titles embed the workload count — "Review 86 current, plausible marketplace leads", then 101, then 110 — so a recurring job never matched its own approval and every run created another action. Fixed by comparing the *shape* of the title with numbers normalised. The fix only decides whether to add another action: it writes nothing to an approved row, so no human decision is rewritten or closed by a run. Covered by six new assertions in `test-agent-planning.mjs`, including that genuinely different work still gets its own decision.

**Dispositions** (`scripts/reconcile-open-agent-actions.mjs`, read-only, writes nothing):

| Verdict | Count |
| --- | --- |
| Superseded by a newer approval of the same job | 11 |
| Run it — machine-executable, no execution evidence | 1 |
| Close as done — the queue it pointed at is empty | 2 |
| Still outstanding — real live work | 2 |
| Needs a person — human work with no measurable queue | 10 |

The 11 superseded ones are listed individually with the id of the approval that replaced them. None were closed here: closing a decision a person made is that person's to do, and bulk-labelling 11 of them would destroy the information anyone would later want.

**A second defect, repaired.** The outstanding-work probe for `triage_scout_leads` counted every lead with no `reviewed_at` — 9657 rows, including years of parked and dismissed leads — against an action that said "review 110 current, plausible marketplace leads". It reported a backlog **88× larger than the job**, which is why five actions previously read "STILL OUTSTANDING 9657". The probe now counts `review_status = 'new'` (2240), and each action also prints the figure the planner itself recorded in its evidence (`scout_review_now` = 110 for the newest). Live lead denominators for the record: 10910 leads total, 9657 with no `reviewed_at`, 2240 `new`.

### Failed agent runs: 4 of 140, one cause, 23 days old

Window examined explicitly: **140 runs, 2026-08-15T12:01Z to 2026-09-13T11:36Z** — 136 `succeeded`, 4 `failed`. All four are `market_scout`, all with the identical `error_message`:

> eBay Scout is not configured. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel first.

Three on 2026-08-20 (manual, initiated by Codex) and one on 2026-08-21 (scheduled). **Root cause: missing eBay credentials at the time, since configured** — the 13 Sep planning evidence records `ebay_connection_ok: 1` and the same scheduled job has succeeded on every run in the 23 days since. This is a transient configuration failure that is already resolved, not a persistent defect, so there is no code to repair.

**Nothing was retried.** Re-running a Scout cycle from 20 August would repeat external eBay work to no purpose; the schedule has long since covered that ground. The reconcile script now groups failures by message, reports the window and the age of the most recent one, and says plainly when none are recent.

The open approval `1f2b47e0 investigate_agent_failures` ("Investigate 1 failed agent runs", approved 21 Aug) is about these. It can be closed — but that is a person's call, so it is reported, not closed.

### Concurrency: still unproven, and genuinely blocked

`scripts/test-concurrency-two-connections.mjs` is the harness. It applies the three shipped migrations to a scratch database, opens two connections, asserts they are **different backend pids**, and proves a held `for update` actually blocks a second session before running anything else.

**It has never been executed.** This machine has no PostgreSQL server, no Docker, no `psql`, nothing listening on 5432, and `.env.local` carries no database password — checked, not assumed. The harness reports `BLOCKED` and exits 0 rather than pretending to pass, and refuses outright if `RAR_TEST_DATABASE_URL` points at Supabase, because the fixtures would write and race real sale evidence.

Exactly what remains unproven:

1. Two simultaneous `confirm_outcome_sale` calls on one outcome produce exactly one sale, and the loser is told why.
2. A confirmation racing a dismissal leaves the outcome and the sale agreeing, whichever wins.
3. A retry after a winner has committed reuses that sale rather than creating a second.
4. A failure inside the transaction leaves no observation, no audit row and no closed outcome.
5. Two workers claiming one agent action produce one owner, and lease recovery does not hand a live action to a second.

Setup needed: `docker run -d --name rar-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rar_concurrency -p 5433:5432 postgres:18`, then `pnpm add -D pg`, then `RAR_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:5433/rar_concurrency`. The fixture builder for the five scenarios is deliberately not written: it cannot be developed against a server that does not exist, and untested test code that appears to pass would be worse than an honest gap.

**Do not read the existing suites as covering this.** `test-outcome-sale-atomicity.mjs` (59 checks) and `test-agent-execution-leases.mjs` (48) run on PGlite, a single backend, and are about rollback, idempotency and refusal — not about what a second concurrent session does.

### Gate

Full suite 80 scripts exit 0, TypeScript clean, lint 0 errors with the two pre-existing `EditionCover` warnings, production build passed.

## Next — all of these need a person, not another migration

1. **Look at the grading card on `/review`.** The catalogue and outcome cards are confirmed rendering on a phone; the grading card is not. With `ff81fb2f` now resolved there may be no conflict left to render it, so this may need a case to be constructed before it can be seen at all.
2. ~~**Resolve `ff81fb2f`.**~~ Done 13 Sep: BGS 8.5, confirmed correct by SP.
3. **Work the 23 open approvals.** `node --experimental-strip-types --env-file=.env.local scripts/reconcile-open-agent-actions.mjs` gives a verdict per action: 1 to run, 1 already clear, 7 genuinely live, 14 needing a judgement.
4. **Decide on graded leads.** `graded_slab` would cut Scout junk by roughly half but costs real buying opportunities. It needs its own queue rather than activation.
5. **Investigate the 4 failed agent runs** out of the last 140.
6. **Still unaudited:** `/agents`, `/scout`, `/catalogue-review`, `/cover-review`, `/add-sale`, public collection and mobile workflows.

Concurrency under two simultaneous connections remains untested — PGlite is a single backend and this machine has no Docker.
