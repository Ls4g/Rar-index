# Beta audit resume — second repair tranche

> Superseded as a worklist on 15 September 2026 by [beta-ready-checklist.md](beta-ready-checklist.md). Read that checklist first for current execution priorities. This document preserves audit evidence and historical checkpoints; its older Next lists are not active instructions.

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

## Phase 3 — Scout: one rule now safe, graded leads routed not dismissed (13 September 2026)

### Baseline, reproduced before changing anything

822 human decisions, split **405 development / 417 holdout** by a stable hash of the case id. Active learned rules: **0** — everything is in shadow.

| | cases | genuine recall | junk rejection |
| --- | --- | --- | --- |
| whole benchmark | 822 | 571/578 = **98.79%** | 46/244 = **18.85%** |
| development | 405 | 272/274 = 99.27% | 26/131 = 19.85% |
| holdout | 417 | 299/304 = 98.36% | 20/113 = 17.70% |

Matches the figures in the earlier tranche, so the benchmark and the split are stable.

### The four junk categories, investigated separately

Junk still reaching a human on the development half (105 cases):

| Category | Cases | Share | Finding |
| --- | --- | --- | --- |
| `graded_not_raw` | 48 | 46% | A rule exists and is the single biggest win available, but it discards genuine opportunities. Routing, not dismissal — see below. |
| `unavailable` | 33 | 31% | **No rule proposed.** The label is hindsight: a person clicked through and the listing was gone. At triage time it still looks live, so no title-based rule can find it without inventing a fact. This is a throughput gap — the availability re-check examines ~25 listings per run against 2240 new leads — not a scoring gap. |
| `multi_volume_lot` | 9 | 9% | Rule refined and now safe. |
| `edition_mismatch` | 8 | 8% | Left alone. These are deluxe, VIZBIG and omnibus listings matched to single-volume editions; deciding them needs the edition identity work, not a title pattern. |

### `multi_volume_lot`: refined on development data, then measured once on holdout

The rule dismissed every title containing "omnibus". Staff had drawn a finer line themselves: **"Initial D Omnibus #1-#9" was dismissed, but "Initial D Omnibus 1 (Vol. 1)" and "Attack On Titan Manga Omnibus Volume 1" were kept.** A single omnibus volume is one book a collector tracking that volume wants; a nine-volume run is not. The blanket pattern cost three genuine opportunities.

The bare-omnibus dismissal is gone. An omnibus listing is still dismissed when the title itself evidences more than one volume — the range, N-in-1 and enumeration patterns already did that on their own.

| | before | after |
| --- | --- | --- |
| development | +6 junk, **−2 genuine** | +6 junk, **−0 genuine** |
| holdout | +8 junk, **−1 genuine** (`Initial D Omnibus 1`) | +8 junk, **−0 genuine** |

Holdout recall is unchanged at **98.36%**, with junk rejection rising **17.70% → 49.56%** for the rule set as a whole and **zero** genuine opportunities newly lost.

**Disclosure about blindness:** the rules were designed against development misses, but the baseline report prints the holdout's lost case by name, so `Initial D Omnibus 1` was visible before the change was written. The two development cases motivated the design and the holdout case is the same pattern, so this is corroboration rather than tuning — but the holdout was not perfectly blind and should not be treated as though it were. The holdout was evaluated once, after the change.

### The harness was reporting readiness for the wrong thing

The verdict was computed over the combined rule set on the holdout alone. That would have green-lit `graded_slab`, which is known to throw away genuine opportunities on the development half — the holdout simply happened not to contain one. Activation is per rule, so readiness is now reported per rule across **both** halves, and a clean holdout is treated as necessary but never sufficient.

| Rule | development | holdout | Verdict |
| --- | --- | --- | --- |
| `graded_slab` | +48 junk, **−1 genuine** | +28 junk, −0 | **SHADOW ONLY** |
| `multi_volume_lot` | +6 junk, −0 | +8 junk, −0 | **READY** |

The one opportunity `graded_slab` destroys is `BGS 7.0 Demon Slayer Kimetsu no Yaiba Vol. 1 1st Print` — a graded first print a person deliberately kept.

### Decisions taken by SP, 13 September 2026

**Graded leads: route them, never dismiss them.** Asked and answered — a dedicated graded queue. On inspection **this already exists and works**, so nothing was rebuilt: `DEFAULT_FILTERS.listingKind` is `"raw"`, so the default working queue already excludes graded leads; a "Graded backlog" quick view holds them with `scoreBand: "all"`; `reviewNow` excludes them; and `scout_graded_leads` counts them for the planner. Verified in Chrome against local dev with production data: the chips read `Review now 111 · High-confidence 15 · Graded backlog 47 · Watching 567 · Dismissed 8074`; Review now showed a non-graded lead, and selecting Graded backlog showed `BGS 9.8 Kagurabachi Vol.1 #1 1st Printing` — present and fully reviewable. `graded_slab` therefore stays in shadow permanently unless the evidence changes; the separation is achieved by routing, which loses nothing.

**`multi_volume_lot`: stays in shadow for now**, despite meeting the bar, because AGENTS.md makes activation a separate human decision and SP chose to hold it. It ships measured and inert.

### Neither rule is wired into anything that runs

`conservativeJunkDismissal` is imported only by the evaluation script and its own unit test. No module under `lib/`, `app/` or `components/` references it, so **nothing is being auto-dismissed today**. `test-scout-junk-rules.mjs` now walks those three trees and fails if any production module imports the rules — the guarantee that graded first prints cannot start disappearing through an accidental import.

### Evidence

`scripts/test-scout-junk-rules.mjs` — extended with six omnibus cases pinning the distinction in both directions, plus the shadow-mode import guard. `scripts/eval-scout-junk-reduction.mjs` — per-rule activation readiness across both halves. Both read-only; the eval writes nothing and activates nothing.

### Remaining coverage gaps

1. **`unavailable` is 31% of the junk staff see and no rule can fix it.** The availability re-check needs throughput: ~25 listings examined per run against 2240 new leads. Raising that is the single largest remaining reduction in what a person looks at.
2. `edition_mismatch` needs edition identity work — deluxe and VIZBIG editions matched to single volumes.
3. The benchmark is 822 decisions. The omnibus distinction rests on three cases; it should be re-measured as the benchmark grows.
4. Junk rejection stays at the baseline 18.85% in production, because the ready rule is deliberately inert.

### Gate

Full suite 80 scripts exit 0, TypeScript clean, lint 0 errors with the two pre-existing `EditionCover` warnings, production build passed.

## Phase 4 — approvals reclassified, one new curator failure diagnosed (14 September 2026)

Read 2026-09-14T~19:00Z. Read-only throughout: **nothing was written, nothing closed, nothing run.**

### Five open approvals had already done their work

The count is still 26, but three of the ten "needs a human look" actions are now answerable from evidence, and two more were already covered by the superseded rule.

`scout_rule_versions.source_action_id` records which action created each rule version. Every one of the 8 shadow-test actions ever raised produced **exactly one** rule version, and none is orphaned. So "did this shadow test run?" is a lookup, not an inference — and all five open shadow-test approvals had already run:

| Action | Produced |
| --- | --- |
| `71d336c5` shadow_test_multi_volume_detection | `multi-volume-language` v1 (26 Aug) |
| `d615840b` shadow_test_first_print_proof_gate | `first-print-proof` v1 (2 Sep) |
| `fa7d13eb` shadow_test_edition_conflicts | `edition-conflict-language` v1 (4 Sep) |
| `153a48b5` shadow_test_multi_volume_detection | `multi-volume-language` v2 (11 Sep) |
| `835f3dc1` shadow_test_first_print_proof_gate | `first-print-proof` v2 (11 Sep) |

**Root cause.** Before `6d7e753` (11 Sep) the execute path read `if (decision === "approved" && action.action_type.startsWith("shadow_test_"))` — it ran the shadow test on *any* approval, while `finalStatus` only advanced to `executed` when running had actually been asked for. A plain approval therefore did the work and left the row looking undone. That is the whole split: the three actions marked `executed` were approve-and-run, the five stuck at `approved` were approve-only. `6d7e753` gated it on `execute` and fixed this going forward, but nothing reconciled the five rows already in that state.

**Do not re-run these.** Each would write a duplicate candidate rule version for a test that already produced its answer.

### Two defects repaired in the reconcile script

1. **It was guessing from timestamps.** The shadow verdict counted rule versions created *after* the approval and returned "NEEDS A LOOK — compare before re-running". It now matches on `source_action_id` and returns CLOSE AS DONE naming the exact rule version.
2. **A failed rule read silently became "RUN IT".** `const { data: ruleVersions } = await ...` ignored its error, so an unreadable `scout_rule_versions` left the map empty and every shadow test fell through to "RUN IT" — advice to re-run work that had already run. The error now exits non-zero. (Found by hitting it: a scratch script selecting a non-existent `notes` column reported "0 rule versions created after" for all five actions, which was the bug, not a finding.)

New verdict split: superseded 11, run it 1, **close as done 5** (was 2), still outstanding 2, **needs a human look 7** (was 10).

### One new agent failure, already fixed by `5b4aefa`

`catalogue_curator` failed on the 11:36 UTC schedule on 14 Sep: `could not prepare discovery: Gateway Timeout`. The other **21 of 22** curator runs in the last 14 days succeeded, so this is a one-off transient Supabase read failure, not a persistent defect.

The recorded message has no `(label, N attempts)` suffix, so the run used the pre-fix code. `5b4aefa` (14 Sep 17:25 UTC, ~6h *after* the failing run) added `runCataloguePreparationRead` — one retry on 502/503/504, gateway timeout, service unavailable, fetch failed and connection reset, with the failing read now named in the error. **The fix is committed and pushed; there is nothing to repair here.**

Open incident `f6fcc37f` "An agent cycle needs inspection" (`consecutive_failures: 1`) was raised at 11:36:25 on that same run, and is what approval `aa1ce91b resolve_agent_incidents` points at.

**Not yet evidence:** no scheduled curator run has happened since the fix. The next one (15 Sep 11:36 UTC) is what would confirm it. Deployment of `5b4aefa` was not verified either.

### `586c8108 scan_stale_profiles` cannot be run from this machine

It is the one "RUN IT" verdict, but executing it calls `runScoutBatch(admin, { limit: 20, dueOnly: true })`, which hits eBay. `.env.local` holds `CRON_SECRET`, both Supabase keys, the anon URL and the throwaway staff credentials — and **no eBay credentials** (checked, not assumed). Attempting it locally would fail inside the try block and write a failed run row for nothing. It needs a person on the deployed `/agents` screen.

### Every open approval now has an evidence-backed verdict

The remaining seven "needs a human look" actions were unmeasured only because their action types were missing from the script's `OUTSTANDING_WORK` map. Adding probes for them takes the category to **zero**.

Final split of the 26: superseded 11, close as done **8**, still outstanding **6**, run it 1, needs a human look **0**.

The probes reuse the planner's own modules — `analyseLiveScoutFeedback`, `readScoutBacklog`/`diagnoseScoutBacklog`, and `agentRuntime`'s readiness-status derivation — rather than restating their rules. "Fewer than one in four leads reviewable over at least ten" and "which dismissals are scorer-relevant" are real definitions that live in `lib/`; a second copy here would drift from the thing it claims to measure, which is exactly how the old `scout_review_now` probe reported a backlog 88× too large.

| Action | Measure | Now |
| --- | --- | --- |
| `204295cc` readiness: search ready | `edition_readiness` rows in that status | **0 — close as done** |
| `4ba1adaa` readiness: collecting | same | 87 — still outstanding |
| `845ed277` tune_low_yield_profiles | `profilesNeedingTuning` | 1 — still outstanding |
| `ddd94480` feedback precision | `scorerRelevantDismissals` | 39 — still outstanding |
| `76f32542` feedback conflicts | `watchedConflicts` | 4 — still outstanding |
| `1f2b47e0` investigate_agent_failures | failed runs in 24h | **close as done, see below** |
| `aa1ce91b` resolve_agent_incidents | open incidents | **close as done, see below** |

**A rolling window is not a queue that drains.** Those last two measure a 24-hour window and an incident list, so a non-zero count can be entirely new trouble rather than the work the action was raised for. Both are in exactly that state: `1f2b47e0` was raised 21 Aug for the eBay failures (long since configured), and `aa1ce91b` 7 Sep for an incident that was resolved — yet both now match today's curator timeout and the incident it raised. The probes compare every item's timestamp against the approval, and when all of them postdate it the verdict says so plainly and prints the items, rather than calling new trouble old work. Without that, both would read STILL OUTSTANDING and a person would go looking for a failure that no longer exists.

**Not covered by a test.** This script is read-only tooling with no unit test, and its verdicts are meant to be checked against the evidence lines printed beside them, not trusted blind.

### Gate

Full suite 80 scripts exit 0, TypeScript clean, lint 0 errors with the two pre-existing `EditionCover` warnings, production build passed. Run twice — once after the shadow-test change, once after the probes.

## Phase 5 — open approvals had no UI at all (14 September 2026)

Found by asking SP to close the 19 finished approvals and run `scan_stale_profiles`, and being told neither could be found. They could not: **neither action was possible in the product.**

### What was missing

`/agents` renders three lists — `proposed` (full cards with buttons), approved *feedback* actions (as bare text, no controls), and the last 10 executed. Approving an action therefore removed it from every screen:

- **22 of the 26 open approvals rendered nowhere.** Including `586c8108 scan_stale_profiles`, the one machine-executable action. The API would have run it — `review_action` accepts `approved` when `execute: true` — but nothing in the UI could call that.
- **Closing was impossible by any route.** `review_action` selects `.in("status", execute ? ["proposed", "approved"] : ["proposed"])`, so a decision without execute only matches a proposal. There was no path, UI or API, to close an approved action. The backlog could only grow.

This is the second half of the one-way door recorded in `preflightAgentAction`: that comment fixed the API's refusal to *run* an approved action, but nothing ever gave the UI a way to *reach* one.

### What was built

An **Open approvals** section on `/agents` listing every approved, unfinished action, with a Run button for executable ones and a Close button for the rest, plus a count in the "What needs you" summary.

Closing is a new `close_action` command, deliberately **not** a decision. `review_action`'s refusal to touch anything but a proposal is the guarantee that an approval cannot be rewritten behind the approver's back, and it is untouched. `close_action` cannot match a proposal, cannot reject anything, and **never rewrites `reviewed_by` or `reviewed_at`** — the original decision stays exactly as the person made it. It writes `cancelled` plus a required reason into `review_notes` and an `agent_action_events` row. No migration: `cancelled` is already in the status constraint, and the reason is what tells a finished job from an abandoned one.

Guards: a live lease refuses the close rather than stranding the worker holding it, and the update is conditioned on the status so two simultaneous closes resolve to one winner instead of both reporting success.

### Evidence

`scripts/test-agent-open-approvals.mjs` — 28 checks, no credentials, in `test:workflows`. Pins every invariant above, including that `review_action`'s original guarantee still holds and that the close button stays dead without a reason (the API refuses a short one, so the UI must not offer a round trip that can only fail).

**Rendering is unverified.** `/agents` sits behind the staff login, so this has not been seen on any screen, desktop or phone. The compiled production CSS (`.next/static/chunks/1-y-zeclfiby3.css`) carries `.agent-close-reason`, its `text-transform: none` override of the uppercase eyebrow that `.agent-proposal-list span` would otherwise apply, `.agent-open-approvals`, and the existing `flex-direction: column` mobile stacking rule that the new section inherits. That is a check of the stylesheet, not of the page. **It needs a phone check.**

### Gate

Full suite 81 scripts exit 0, TypeScript clean, lint 0 errors with the two pre-existing `EditionCover` warnings, production build passed.

## Phase 6 — approvals reserved for decisions (15 September 2026)

SP asked what the approvals were actually for. The honest answer: of the 26 open, **exactly one was work a machine would carry out**. Fifteen were the planner telling a person that a queue had items in it — a queue with its own page, already showing its own count. Approving one caused nothing to happen, and until Phase 5 there was no way to mark it done, so each sat open while the next run raised another.

### The rule

`STANDING_QUEUE_ACTIONS` in `lib/agentPlanning.ts` names them, with `needsHumanApproval()` as the single predicate. An approval is now reserved for work that will not otherwise happen unless a person decides: a machine that acts on approval, or a genuine change of behaviour being proposed.

Retired to live counts: `triage_scout_leads`, `review_catalogue_queue`, `research_catalogue_requests`, `source_missing_covers`, `review_sales_evidence`, `classify_printing_evidence`, `review_community_reports`, `resolve_readiness_bottleneck`, `investigate_agent_failures`, `resolve_agent_incidents`.

The last two are there for a different reason: both duplicate a control that already exists on `/agents` — the run log, and the incident panel's own Resolve button.

Still decisions: `scan_stale_profiles`, every `shadow_test_*`, `tune_low_yield_profiles`, `review_scout_rule_regression` and the `review_scout_feedback_*` investigations.

### Nothing is lost

The planner still computes every one of them. The filter is at the point of *writing* an action, in `reconcileAgentProposals`, not at the point of planning — so each run's `summary` and `metrics` carry the counts exactly as before, plus `queues_reported_not_raised`.

On `/agents` the three catalogue figures join the Scout and evidence counts already in the summary row, each linking to its queue. A live count is more current than a day-old approval and needs no closing.

Existing `proposed` rows of these types are retired automatically with a note saying why. **Approved ones are not touched** — an approval is a decision a person made, and a rule change must not reach in and close it. Those stay for SP to close on `/agents`.

### Expected effect

Fifteen of the twenty-six would never have been raised. Steady state should be roughly one to four open approvals rather than a backlog that only grows.

### Evidence

`scripts/test-agent-open-approvals.mjs` — now 51 checks. Asserts the predicate both ways, and specifically that **no machine-executable action was retired**: quietly auto-running work would be the worst possible reading of "fewer approvals". Also pins that only untouched proposals are retired and that the retirement is conditioned on the status.

**Rendering still unverified** — same staff-login reason as Phase 5. The new summary tiles have not been seen.

### Gate

Full suite 81 scripts exit 0, TypeScript clean, lint 0 errors with the two pre-existing `EditionCover` warnings, production build passed.

### Phone check recorded, 14 September 2026

SP confirmed on a handset, nothing off: `/listing-outcomes` pager to page 2 and back, queue chip counts matching the range that loads, and the "Find a listing" search with the keyboard up. Still unchecked: the homepage cover shelf swipe, the grading card on `/review`, and everything added in Phases 5 and 6.

## Next — all of these need a person, not another migration

Rewritten 15 September 2026, after Phase 6. Everything previously listed here that is now closed has been removed; the gap table in `beta-audit-findings.md` carries the full record.

### Needs a phone, and nothing else

1. **Look at Phases 5 and 6 on a handset.** The Open approvals section, its Run and Close controls, and the summary tiles have never been seen on any screen. They exist as 51 passing checks and a compiled stylesheet. That is not a page check.
2. **The grading card on `/review`.** Still unseen on a phone. With `ff81fb2f` resolved there may be no conflict left to render it, so a case may need constructing before it can be seen at all.
3. **The homepage cover shelf swipe.** The one item left from the 14 September phone check.

### Needs the deployed staff UI

4. **Close the 19 finished approvals** on `/agents` — 11 superseded, 8 done. Phase 6 deliberately does not close these: an approval is a decision a person made. Each close needs a reason; that is what tells a finished job from an abandoned one.
5. **Run `586c8108 scan_stale_profiles`.** The single machine-executable action. It calls `runScoutBatch` which hits eBay, and `.env.local` holds no eBay credentials (checked, not assumed), so it cannot be run from this machine — attempting it locally writes a failed run row for nothing.
6. **Work the 6 genuinely outstanding actions:** 87 editions in readiness `collecting`, 1 low-yield profile to tune, 39 scorer-relevant dismissals, 4 watched conflicts, and the two remaining live queues. Verdicts and counts come from `node --experimental-strip-types --env-file=.env.local scripts/reconcile-open-agent-actions.mjs`, which writes nothing.

### Needs a decision from SP

7. **Whether `multi_volume_lot` leaves shadow.** Measured safe on holdout — junk rejection 17.7% → 49.6%, zero genuine opportunities lost. Held in shadow at your choice, and wired into nothing that runs. `graded_slab` stays in shadow permanently by design.

### Needs infrastructure this machine does not have

8. **Concurrency under two simultaneous connections.** PGlite is a single backend, so `for update` blocking a second session cannot be observed. Needs Docker or a real server; neither is available here, and no database password is either. The harness is written and self-refuses against production.
9. **Availability throughput.** 31% of the junk staff see is unavailable listings, and the label is hindsight — no rule fixes it. The re-check examines ~25 listings per run against 2240 new leads.

### Waiting on a clock

10. **Confirm `5b4aefa`.** The curator retry fix shipped ~6h after the 14 Sep gateway timeout. The next scheduled run (15 Sep 11:36 UTC) is what would confirm it, and its deployment was never verified either.

### The standing gap behind all of it

**No staff decision *write* has been exercised against production.** Every verification so far has been read-only, on fixtures, or against synthetic data. Items 4 and 5 above would be the first — which is also why they are worth doing carefully rather than in bulk.
