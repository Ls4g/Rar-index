# RAR staff-supervised beta checklist

Created 15 September 2026 from local HEAD `0bb6489`, current audit documents (including pre-existing uncommitted updates), Git history and targeted source inspection. No live services, credentials or application workflows were accessed for this review. Production state is not freshly verified.

This is the sole active beta-readiness worklist. It supersedes the earlier three-phase implementation prompt and every historical Next/priorities/gaps list in `beta-audit-resume.md` and `beta-audit-findings.md`. Those documents remain evidence/history, not parallel task lists. Update this checklist as work proceeds.

## Instructions for Claude

Read `AGENTS.md`, this file, then the latest sections of both audit documents and recent Git history. Inspect status/diffs and preserve unrelated changes, including existing audit edits and local settings. Read relevant installed Next.js documentation before application changes. Reuse existing workflows.

Statuses: OPEN, IN PROGRESS, VERIFIED, BLOCKED, or DEFERRED BY SP. For every gate record date, commit, environment, evidence/test result, unresolved gaps and owner. A passing command or a user's general "all done" is not evidence of a specific untested scenario. Accept specific prior human checks without asking for them again. Recount changing data before acting; record timestamp, definitions and denominator. Never assume old counts are current or equate capped query results with totals.

Work through gates in order; continue independent work when infrastructure or a specific human decision blocks one item. Repair supported defects, not hypothetical ones. Run targeted tests during development. At each completed implementation phase run `corepack pnpm run test:workflows`, `corepack pnpm run lint`, `corepack pnpm exec tsc --noEmit` and `corepack pnpm run build`; use and document the established direct TypeScript fallback only if necessary. Derive actual test coverage/counts from current commands rather than repeating the historical "81 scripts" claim. Avoid repeating unchanged passing suites. UI changes require browser verification. Commit and immediately push each completed phase separately, staging only its changes. Documentation-only checkpoints need diff/link review, not an application rebuild.

## Evidence boundaries — apply throughout

- Only a human may verify a sale, edition match, printing or grading. A sale requires a completed transaction and working original source link, with exact edition identity: ISBN, publisher, printing and binding consistent.
- Active or ended-unsold listings and titles alone are never sale evidence. Scout leads never influence valuation or charts. Uncertain identity stays in Scout/review.
- Keep raw/graded and printing comparison groups separate; use existing `comparisonGroup()` conventions. Charts require at least three sales in the same group. Never invent prices, dates, currencies, ISBNs, grades or edition claims.
- Automation may narrow review or dismiss obviously wrong leads, never verify evidence or overwrite a human decision. Record automated decisions in the existing human-visible audit tables and validate on representative real titles.
- Source confirmation must be an explicit human act, never a default or inferred checkbox. Do not alter genuine evidence or create production conflicts for tests. Keep synthetic data in an isolated test environment. Do not redo SP's resolved BGS 8.5 correction.
- Schema/function changes require additive migrations under `supabase/migrations/`, applied through the repository's prescribed workflow. Never destructively alter existing data without explicit confirmation. Preserve staff auth and credential restrictions.
- Cut scope explicitly and list exact gaps. Never weaken evidence requirements to improve coverage.

## Established progress — do not rebuild

Local history/source and recorded checks support these implemented repairs; deployment claims still need matching release evidence where relevant:

- Atomic outcome-to-sale RPC, grading correction, permission restrictions, valuation separation and durable execution leases.
- Outcome pagination, honest view classification/counts and focused links; handset pagination/search check specifically recorded on 14 September.
- Catalogue handoff and homepage cover layout repairs; isolated grading fixture found and repaired false source confirmation.
- Approval reconciliation now uses original job scope and rule-version source IDs. `/agents` gained Open approvals Run/Close controls (`76924d6`); standing queues became live counts instead of new approvals (`0bb6489`). Neither latest UI was recorded as rendered.
- Historic eBay credential failures diagnosed; curator transient-read retry implemented in `5b4aefa`, with subsequent deployment/run confirmation outstanding in the notes.
- Graded Scout queue already exists. Both experimental junk rules are unwired. `graded_slab` loses a genuine development case; `multi_volume_lot` remains shadow by SP's choice. Do not reactivate this settled decision as a launch requirement.

## Live state — read 2026-09-15T13:50:33Z

Read-only against production project `fmzzersppzqevtwqvnbd` plus the public GitHub deployments API. Recorded because every count below had moved since the audit documents were written; treat these as a snapshot with a timestamp, not a standing figure.

**Release.** Local `main` HEAD `0bb6489` is in sync with `origin/main` and **is the deployed Production commit** (`sha=0bb648963`, deployed 2026-09-15T09:33:59Z, state success). Phase 5 (`76924d6`) went live 2026-09-14T22:43Z. `5b4aefa` is deployed as an ancestor. Deployment URL `rar-index-6edmxe8zd-ls4gs-projects.vercel.app`; no version or health endpoint exists in the app, so this was established from the deployments API, not from the running site.

**Agent actions.** `cancelled` 25, `executed` 86, `proposed` 7, **`approved` 0**. The 26-approval backlog is gone: `review_notes` shows 20 closed by hand ("Closed by SP: Done"), 3 auto-retired by the Phase 6 rule, 2 by older supersession. **The Phase 5 Open approvals UI has therefore been used successfully 20 times in production** — functional evidence, not rendering evidence. Note `reviewed_at` on a closed row is the date SP *approved* it, not the date it closed; `close_action` deliberately preserves it.

**Phase 6 confirmed in production.** All 7 current proposals are decision-types — `tune_low_yield_profiles`, `scan_stale_profiles`, two `review_scout_feedback_*`, three `shadow_test_*`. No standing-queue type was raised. All 7 created 2026-09-15T11:36Z.

**Today's three shadow tests are safe to run.** All 8 rows in `scout_rule_versions` were checked: none carries today's action IDs as `source_action_id`. Phase 4's "do not re-run these" applied to the five now closed.

**Curator recovery confirmed, retry still untested.** `catalogue_curator` succeeded 09:15:25Z and 11:36:00Z today, after the 14 Sep gateway timeout. Per this checklist's own standard, a successful run demonstrates recovery; the retry path itself has not been exercised by a fault test.

**Listing outcomes.** active 764, ended_pending_check 883, unsold 149, review_complete 40, ambiguous 24, inaccessible 11, sold_candidate 4 — 1875 rows, against the 1812 in the audit documents.

**Test suite size.** `test:workflows` chains **38** script invocations. The historical "81 scripts" figure in the audit documents is not the script count and should not be repeated.

## Finding — the reliability alarms cannot clear, and two of the three are not faults

Raised 2026-09-15T12:00Z, all `severity: critical`, all still open: `evidence_sale_guard` (4), `catalogue_curator_guard` (29), `market_scout_match` (7).

The gate is absolute, not comparative — `critical_safety_regressions: { passed: criticalFailures === 0, required: 0 }` — yet the incident is typed `rule_regression` and nothing compares against a previous run.

**Two distinct situations are being treated identically.**

*Automation discarded something good.* `market_scout_match`'s critical condition is a genuinely useful lead being auto-dismissed. The loss is invisible and unrecoverable. **This is a real alarm and should stay one.**

*A completeness check disagreed with a person.* `evidence_sale_guard`, `catalogue_curator_guard` and `cover_provenance_guard` only ask whether fields are present and well-formed — e.g. `confirmed && source && price && currency && date && edition ? "eligible" : "reject"`. A "critical failure" means a human excluded a record whose fields were all complete. All four of today's `evidence_sale_guard` failures show every diagnostic `true` and score 100. **Nothing went wrong:** the human decision stands, and these guards only narrow what a person is shown. It cannot reach zero unless every record a human ever rejected also had a missing field, and it grows as staff reject more (28 → 29, 0 → 4).

**Evidence it is churn, not regression.** 14 `rule_regression` incidents raised, 11 resolved by SP, every one re-raised on the next evaluation. Counts are flat across runs — market_scout 7,7,7,7,7,7,7,7; catalogue_curator 29,29,29,29; evidence_sale_guard 4,4,4,4 — and stay flat as the benchmark grows (evidence_sale_guard 43 → 63 cases, still exactly 4). The same specific cases fail every time. Resolving an incident cannot change the benchmark, so it returns on the next cron. This is the Phase 6 approvals pattern one layer down.

**The benchmark itself is sound.** `agent_benchmark_cases` is intentionally append-only with snapshot versioning (`supersedes_case_id`), and `latestBySubject()` takes the newest snapshot per subject, breaking ties on `created_at`. 107 stored rows, 63 evaluated. The counts are not inflated.

**BUILT 16 September 2026.** `UNSUPERVISED_EVALUATORS` in `lib/agentReliability.ts` now names the only evaluator whose critical failure means automation acted on its own — `market_scout_match`, where an auto-dismissed genuine lead is gone from every screen with nobody able to tell. That one still raises a critical incident, retitled "dismissed leads a person wanted" rather than "failed a safety gate". The four completeness checks no longer raise one: their count is recorded as `human_disagreements` in the run metrics and shown on `/agents` as "times a person disagreed" instead of "safety regressions", and a non-zero count no longer flips the card to "Needs attention". The zero-tolerance gate is now only composed in for the unattended evaluator, since elsewhere it counted human judgement and could never pass. `EVALUATOR_VERSION` moved 2 → 3 so the suites replay.

**Existing open incidents are untouched.** The three currently open will not be re-raised for the supervised evaluators once SP resolves them, because nothing writes them again. `market_scout_match` stays a genuine alarm and will return while leads are being lost. No incident was resolved by this change — that is a person's decision.

**Gates:** `test:workflows` all suites exit 0 (79/79 and 51/51 on the two agent suites), lint 0 errors with the two pre-existing `EditionCover` warnings, `tsc --noEmit` clean, production build exit 0. Tests pin that Scout still raises, that the other four do not, that a dismissed exact match is still a critical failure, that a human rejecting a complete record is still recorded at case level, and that every evaluator carries an explicit classification so a new one cannot silently inherit a default.

**Unverified:** the `/agents` label change has not been seen rendering. Needs a phone check.

**Original proposal, now superseded by the above:** keep the auto-dismissal case as a critical incident; report the completeness-check disagreements as a live count on `/agents` instead of a daily critical alarm, in the same shape as Phase 6's standing queues. Effect: alarms fire only when automation actually loses something.

## Phone check 2026-09-15, and the Day-mode defect it found

SP checked `/agents` and the public surfaces on a handset at ~23:01 local and reported every listed item clear: the "What needs you" tiles rendering and linking, the "Open approvals" heading and copy (the section is empty — 0 approved actions), the 7 recommendation cards, the homepage cover shelf swipe, and the `/review` grading card. **Gap 14's listed items are closed on a real handset.**

SP also reported text that could not be read, with a screenshot. Diagnosed and fixed.

**A half-finished theme integration.** `editorial-system.css` had already brought the console's *containers* into the theme — `.agent-control-content`, `.agent-workbench`, `.agent-autopilot-metrics`, `.agent-reliability-panel`, `.agent-history-panel`, `.agent-feedback-panel` and the control buttons are all themed there, across four separate rules. Its *text colours* were left in `globals.css` as Night literals. So in Day the surfaces went light while `#f5eee4` values, `#f5eee4` titles and an `#e8dfd4` Resolve button stayed near-white. Night masked it completely, because `--rar-canvas` is `#101217` there.

**Why only part of the page broke.** Sections with a *solid* dark fill stayed legible — `.agent-workbench` (`#1b1916`), `.agent-proposals` (`#191714`), `.agent-proposal-list article` (`#211e1a`). Sections with a *translucent* fill that assumed a dark parent went pale and took their near-white text with them: `.agent-autopilot-panel` (`rgba(53,89,151,.1)`), `.agent-autopilot-metrics span` (`rgba(0,0,0,.14)`), `.agent-incident-list article` (`rgba(238,91,75,.09)`) and `.agent-kill-switch` (`rgba(93,204,159,.06)`). That is exactly what the screenshot shows: readable tiles, invisible cycle values, invisible incident titles, a ghosted Resolve button.

**Scope:** two pages only — `/agents` and `/agent-learning`, the only routes carrying `agent-control-page`. Every other staff page uses plain `review-page catalogue-page` and follows the editorial tokens correctly.

**First fix was wrong and was reverted.** It forced the console dark via `.review-page.agent-control-page`, on the reading that a dark console was intended. It changed nothing visible: `.agent-control-content` is themed at `(0,2,0)` in `editorial-system.css` and sits on top of the `<main>` that was darkened. More importantly the premise was wrong — the codebase had already decided the console follows the theme.

**Fix applied:** the theme integration is finished where it belongs, in `editorial-system.css`. One block converts the console's text, border, button and panel colours to tokens — `--rar-ink`, `--rar-muted`, `--rar-line`, `--rar-surface`, with semantic panels mixed into the surface via `color-mix` so incidents keep their meaning without assuming a dark parent. Selectors are `.review-page :is(…)`, which beats the literals on specificity `(0,2,1)` vs `(0,1,1)` **and** loads from the later chunk, so it does not depend on import order. `globals.css` keeps only `min-height`. Covers `/agent-learning` as well, which has the same defect and has not been looked at.

`docs/design.md` now records that the console follows the theme, that its colour lives in `editorial-system.css`, and that a surface themed in one file but coloured in the other is itself the bug.

**Gates:** lint 0 errors (the two pre-existing `EditionCover` warnings remain), `tsc --noEmit` clean, production build exit 0. Compiled CSS verified: the token rules for `.agent-autopilot-metrics b`, `.agent-incident-list strong`, `.agent-incident-list button` and `.agent-workbench-grid strong` are all present in the later chunk, and the reverted dark override is absent. `test:workflows` was **not** re-run — CSS only, no TypeScript or workflow logic touched.

**Still unverified:** the fix itself, and `/agent-learning` has never been looked at in any theme. A handset reload of `/agents` in Day is needed to confirm the cycle values, incident titles and Resolve button are legible, and Night should be re-checked since the console's colours changed there too. Compiled-CSS inspection is not a page check — the first attempt passed every compiled check and changed nothing on screen.

## Public-page contrast, 16 September 2026 — partly repaired, long tail remains

SP reported text that could not be read across the public pages and sent a Night-mode screenshot of `/edition/[id]`: section headings rendering near-black on a near-black canvas.

**Root cause, same family as the agent console.** `globals.css` carried a block selecting `.home-page, .edition-page` **and** `html[data-theme="night"] .home-page/.edition-page` explicitly, then set the Day palette as literals inside it — `--canvas-heading: #0b0b0d`, `--line: #dadddf`, `--surface-card: #fff`, `background: #fbfbfa`. At `(0,2,1)` it outranked the editorial tokens at `(0,1,0)`. `background` and `color` were rescued by an editorial rule at equal specificity loading later, but **the custom properties were not** — so Night got a correct dark canvas with Day headings, Day hairlines and white cards.

**The repair.** Those literals were exactly the Day values of the `--rar-*` tokens (`#d80d1c` is `--rar-red`, `#5f6879` is `--rar-muted`, `#dadddf` is `--rar-line`, `#0b0b0d` is `--rar-ink`, `#ffffff` is `--rar-surface`), so substituting tokens is a no-op in Day and correct in Night. Roughly 90 literals were converted across `globals.css`, plus 28 background whites. `color: #fff` was deliberately left alone — white on the red brand button is correct.

**Measured, not assumed.** A WCAG contrast audit was run in a real browser against the running app, walking every text-bearing element and compositing effective backgrounds through translucent ancestors. Both themes, before and after.

| Page | Night before | Night after | Day before | Day after |
| --- | --- | --- | --- | --- |
| `/` | 17 | 16 | 6 | 6 |
| `/edition/[id]` | 30 | 25 | 2 | 2 |

Day never regressed at any step, which was the safety check on a change this broad. Every catastrophic case on `/` — ratios of 1.03, 1.05, 1.17 and 1.43, effectively invisible — is gone.

**One intermediate step made Night worse (17 → 22) before better.** Theming the backgrounds exposed text literals that had been sitting on white cards and were not yet mapped. Those were then mapped. Recorded because the audit caught it and an eyeball would not have.

**Handset check, 16 September 2026: SP confirmed the public pages read clearly in Night.** That is the check that counts — the audit is arithmetic on computed styles, and the first agent-console attempt passed every compiled check while changing nothing on screen. The reported defect is closed.

**One caveat worth keeping.** The audit still flags a 1.1-ratio case on `/edition/[id]` (`.source-card` computing white in Night) that SP did not see. Both can be true — the element may sit below the fold or render only for certain editions. It stays open rather than being closed on "looks fine", because a contrast failure nobody happened to scroll to is still a contrast failure.

**Still open — this is not finished:**

- `/edition/[id]` still reports 25 in Night, worst `1.1` — `.source-card` computes a white background in Night and no rule inspected so far explains it; several rules compete for that element and the winner was not identified. Needs a proper look, not another sweep.
- A cluster of brand red at small sizes lands at 3.2–4.4 against a 4.5 requirement. That is a **design decision, not a defect** — fixing it means changing RAR red, which `design.md` treats as settled.
- The theme-toggle finding is probably an artifact of the audit setting `data-theme` directly while the component's own React state disagreed; `AGENTS.md` warns about exactly this. Not treated as a bug.
- Only `/` and one `/edition/[id]` were audited. `/browse`, `/collection`, `/portfolio`, `/identify` and the collector pages were not.
- **Nothing here has been seen on a handset.** The audit is arithmetic on computed styles, not a page check.

## Gate 1 — Confirm the release and finish staff usability (IN PROGRESS)

- [x] **VERIFIED 2026-09-15.** Match local commits to the deployed version using authorized read-only checks. Recount outcome views/queues, open actions by unique job, current incidents and recent runs over a named time window. Confirm whether the curator retry fix is deployed and inspect subsequent scheduled runs; a successful run demonstrates recovery, while targeted fault tests establish retry behavior.
- [ ] **OPEN — rendering unverified; 20 production closes are functional evidence only.** Inspect `components/AgentControlCentre.tsx`, `app/api/agents/route.ts`, `lib/agentPlanning.ts` and `lib/agentRuntime.ts`. Verify Open approvals, Run/Close controls, required close reasons and live summary links in a real authenticated desktop browser and on a physical phone. Confirm all open items are reachable, failures remain visible, controls update after success and approval identity/timestamp are preserved.
- [x] **VERIFIED on a handset 2026-09-15; one defect found and repaired, repair itself still unverified.** Finish the specific handset gaps: homepage cover shelf swipe/link access; grading card raw/graded controls and source confirmation using the real component/route with isolated fixtures. Never manufacture a production grading conflict. Record fixture versus production evidence distinctly.
- [ ] Verify navigation and representative interaction across `/review`, `/listing-outcomes`, `/scout`, `/catalogue-review`, `/cover-review`, `/add-sale`, public collection and `/agents`. Reuse prior valid evidence for unchanged surfaces; concentrate fresh checks on changed or untested flows. Check hydration, keyboard/overflow and actionable error states. CSS inspection and desktop iframes do not establish handset success.

Acceptance: current release identified; new staff surfaces rendered and usable; no inaccessible required action or false confirmation; exact remaining human-only checks listed. If a phone is unavailable, provide one concise checklist and keep that item BLOCKED.

## Gate 2 — Complete real concurrency tests (BLOCKED — no PostgreSQL, Docker or psql on this machine, and no database password)

Inspect `scripts/test-concurrency-two-connections.mjs` before running it. It is a scaffold: five scenarios are printed as TODO, fixtures are absent, its three migrations do not bootstrap an empty database, and blocked/incomplete paths can exit zero. Do not report it as a completed test harness.

- [ ] Provide an isolated PostgreSQL instance, safe explicit test-database targeting and required driver. Never target production. Build the prerequisite schema/roles/functions from the real migration dependencies, then apply shipped SQL. Add cleanup limited to test-owned data and bounded timeouts/connection cleanup.
- [ ] Implement fixtures and assertions for simultaneous confirmations, confirmation versus dismissal (both winner orders), retry after committed confirmation, transaction failure with no partial sale/audit/closure, and competing action claims plus lease recovery. Use actual production paths/contracts, not a simplified replacement.
- [ ] Prove two different backend sessions and genuine contention using deterministic coordination; do not rely solely on elapsed time or the existing Promise.race probe. Assert final persisted state and audit history, not only return values.
- [ ] Include close-versus-claim and duplicate-close behavior for the new approval controls. Repair any demonstrated race or audit inconsistency with appropriate additive migrations and targeted regression tests.
- [ ] Make missing prerequisites, skipped scenarios and incomplete fixtures unmistakably non-passing to the readiness gate. Record individual scenario results. PGlite remains useful for atomicity but cannot substitute for these runs.

Acceptance: every required scenario executed against two real connections and passed; no contradictory outcomes, duplicate evidence, lost human decisions or unaudited mutations. Infrastructure alone does not close this gate.

## Gate 3 — Validate real staff operations and reconcile legacy work (IN PROGRESS — the legacy backlog is already closed; see Live state)

- [x] **Largely VERIFIED 2026-09-15: 0 approved actions remain, 20 closed by SP through the new UI.** Run the existing read-only reconciliation script after inspecting it. Freshly classify actions by original scope and supporting records. Historical split was 26 rows: 11 superseded, 8 done, 6 outstanding and 1 executable; these are not instructions to close current rows blindly. Never rerun shadow tests that already produced their rule version.
- [ ] Present precise per-action recommendations to SP. Have the authorized staff workflow close genuinely finished/superseded actions with reasons, preserving prior approvals and auditing closure. Confirm UI, persisted state and audit agree. Obtain a specific human decision where absent; no blanket automated closure.
- [ ] If still due and authorized, run the existing stale-profile action through the deployed workflow with working eBay configuration. Verify one execution, visible results and retained approval on failure. Do not launch a known-to-fail local eBay workflow.
- [ ] Verify representative staff write paths safely against an isolated database, including sale intake, grading, catalogue handoff, refusal/retry and audit behavior. For production, observe an actual legitimate staff operation when one is available and approved, then check its persisted result read-only. Never create a sale or invent evidence just to pass a test. Distinguish isolated end-to-end coverage from production confirmation; document the first supervised operation if production confirmation must occur during the pilot.
- [ ] Verify subsequent agent cycles do not recreate standing-queue approvals and that live counts still link to the work. Give remaining genuine jobs owners and a practical review cadence. Beta does not require draining every catalogue/Scout queue or forcing approvals to zero.

Acceptance: accessible, audited staff operations work; legacy actions have evidence-backed dispositions; live work remains visible and owned; no duplicate execution or hidden failure. List any production confirmation still requiring an actual staff operation.

## Gate 4 — Establish sustainable availability and a bounded pilot (OPEN)

- [ ] Inspect `lib/scoutAvailability.ts`, `lib/ebayScout.ts`, `lib/scoutDiagnostics.ts`, `lib/agentRuntime.ts`, the availability-result RPC and schedules. Local code currently caps refreshes at 25. Measure arrivals, eligible stale backlog, checks, inconclusive results, age distribution and departures over the SAME time window. The historical 2,240 new leads versus 25 per run is not itself an arrival/service-rate comparison; `queued` currently reports the limited batch length.
- [ ] Establish current API/runtime budgets before changing throughput. Repair misleading counts and any demonstrated bottleneck with bounded batches/concurrency, fair progress, timeouts/backoff and observable outcomes. Never classify an inconclusive response as unavailable or touch prior human decisions. Keep unavailable leads out of sale evidence.
- [ ] Test representative availability responses, rate limiting, partial failure, retry, fairness and races with human review. Verify audit consistency. Measure the deployed result over scheduled cycles; do not claim capacity improvement from a larger constant alone.
- [ ] Agree a limited pilot scope, staff owner, review cadence and measurable freshness/backlog tolerances with SP using the measured capacity. A bounded scope is acceptable; silently accepting unbounded stale review work is not.
- [ ] Keep both experimental Scout rules in shadow. Preserve graded routing and import guards. Optional future lot-rule activation requires SP to change the existing hold decision plus per-rule development/holdout evidence with no new genuine losses. This is not a beta blocker.

Acceptance: pilot workload has a measured capacity/freshness plan; failures are visible; ownership and escalation are clear; no evidence safeguards weakened.

## Final beta decision and interruption checkpoint

- [ ] Record final release commit/deployment evidence, required checks, browser/handset results, concurrency scenarios and remaining limitations. Do not certify full readiness while a required gate is BLOCKED.
- [ ] Give SP a concise GO / NO-GO recommendation for the explicitly scoped staff-supervised pilot. Any deferred check needs its impact, owner and explicit SP acceptance; distinguish accepted limitations from verified behavior. Define who pauses the pilot for evidence corruption, duplicate execution or inaccessible staff actions and the existing recovery/revert route.
- [ ] Keep ordinary catalogue coverage, noncritical tuning and optional Scout activation in a separate post-beta list; do not continually expand launch scope.

If interrupted, update this file with exact branch/HEAD, phase status, changed/uncommitted files, commands/results, migrations applied or unapplied, deployment state, remaining decisions/blockers and the next executable step. Link supporting evidence from the audit documents without reviving their superseded task lists.
