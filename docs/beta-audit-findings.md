# Beta audit — 13 September 2026

This is the first repair tranche, not a beta-readiness certification. Baseline: main at `86f8b29`. No production evidence was created or corrected by the audit. No schema changes.

## Priority findings

| Priority | Problem and root cause | Repair / measurable acceptance |
| --- | --- | --- |
| P0 | Outcome confirmation inserted raw observations then reviewed separately, losing grade and Best Offer distinctions and permitting partial writes. | Both `/review` and `/listing-outcomes` use one explicit human confirmation and existing transactional sale-intake RPC. Grade details and accepted-price corroboration are required where applicable. Tests assert sale/audit failure leaves no partial evidence; retry reuses the verified record and closes the queue. |
| P0 | Worker writes could race with human outcome reviews; failed audit writes and queue reads were not reliably surfaced. | Conditional writes protect status, attempt count, reviewer and resulting observation; audit must succeed before mutation. Regression tests cover late human decisions, provider failure, audit failure and read failure. Trading endpoint/ID behavior is unchanged. |
| P0 | Portfolio valuation pooled graded/raw and printing evidence, added separate currency medians as if they were separate assets, and could report a loss against incomplete costs. | Raw evidence is checked explicitly; printing groups remain separate; specific printings require matching numbers; one currency evidence group supplies each holding value. Incomplete whole-portfolio comparisons withhold gains/losses. Stateful calculation tests cover these cases. |
| P0 | An existing verified BGS-titled observation has empty grading fields. | Unresolved grading is excluded from raw portfolio calculations and price-series construction. Human source correction remains required for `ff81fb2f-201d-4ef1-85db-74171ae76b2a`. No grade was inferred or written from its title. Other database summaries still need inspection. |
| P1 | Retrying a shadow test after candidate insertion returned an unevaluated candidate; partly failed scans reported execution complete. | Candidate retries execute evaluation; partial scans return actionable failures while retaining successful work and approval metadata. No rule autoactivation or scoring changes. |
| P1, outstanding | 23 older approved proposals remain open. Approval also serves as an execution claim, without a durable lease/recovery state. | Add additive durable execution/recovery support; reconcile each legacy action against actual work before closing or retrying. Do not bulk label these completed. Measure stale approved count and duplicate execution count. |
| P0, outstanding | Saving the sale/audits is transactional, but closing its outcome remains a separate write. Concurrent cross-table human decisions are not fully serialized. | Extend the existing intake transaction through an additive migration to lock/close the outcome atomically. Current retry protects duplicate observations; it does not eliminate this race. |

## Agent and workflow trace

`vercel.json` schedules Scout discovery at 09:00 UTC, outcomes at 09:30, the four-agent guarded cycle at 11:00, reliability at 11:30 and portfolio snapshots at 06:30. Staff can also run agents/cycles manually. The guarded cycle runs agents in sequence, records results and closes health through `finish_agent_cycle`.

| Agent | Reads / creates | Human boundary and remaining investigation |
| --- | --- | --- |
| Market Scout | Search profiles, coverage, leads, human decisions, outcome backlog; refreshes availability and proposes scans/rules. | Leads remain buying opportunities. Human decisions feed diagnostics and shadow evaluation. Recall/filtering thresholds unchanged; measure junk rejection before changing allocation. |
| Catalogue Curator | Catalogue requests, existing editions, discovery lanes and source candidates; stages review candidates. | Catalogue facts require human approval. Latest observed run staged two candidates. Lane diversity, missing-volume detection and coverage propagation need deeper verification. |
| Evidence Auditor | Unreviewed sales, printing evidence and community reports; prepares printing suggestions. | Human verifies sale/match/printing in existing review workflows. No new automatic verification. Full suggestion completion lifecycle remains to test. |
| RAR Operator | Readiness, runs, incidents, actions, rule versions and cycle health; proposes work. | Supported scan/shadow actions preflight, claim approval, execute and close. Legacy approvals and crash recovery remain outstanding. |

Proposal reconciliation uses dedupe keys, refreshes current proposals and cancels obsolete proposals; approved items can suppress new recommendations. The observed legacy backlog therefore matters beyond dashboard clutter. Audit/feedback records exist, but collection alone does not demonstrate effective learning in every agent.

## Staff effort and evidence

One form now handles outcome approval in both staff entry points. Existing accepted-price corroboration is reused; optional notes stay optional; queue-close retries do not recreate or reverify evidence. Raw/graded confirmation adds a necessary evidence decision where the old shortcut silently assumed raw. No measured minutes saved or recall improvement is claimed.

Read-only baseline on 12 September: 811 benchmark decisions; genuine-opportunity recall 560/567 (98.77%); junk rejection 46/244 (18.85%). These are the latest stored figures inspected, not the older approximate figures in the task brief. All four latest daily runs succeeded. Outcomes: 723 active, 918 pending checks, 87 unsold, 15 ambiguous, 5 sold candidates, 22 completed reviews, 4 inaccessible. Counts are snapshots, not current totals.

## Verification and scope limits

The workflow suite (32 scripts), direct TypeScript check, lint and full Next.js 16.2.9 production build passed. Lint retains two pre-existing `EditionCover` image warnings. Four new regressions exercise production helpers with mock database state, including failures/retries; they are not live database mutation tests. The standard pnpm TypeScript launcher was unavailable, so the installed TypeScript entry point was used directly.

Authenticated production `/review` and `/listing-outcomes` were inspected with real listings. Raw selection enables confirmation; graded selection reveals required company/grade fields; no sale decision was submitted. Public home was inspected earlier. Deployment of `326ad78` and mobile follow-up `bdbdd70` succeeded in Vercel. Final `/review` form was visually checked on desktop and a real 390px viewport: 44px control heights, 16px input text, no horizontal document overflow. Temporary selections and viewport overrides were reset. No actual phone or live database mutation end-to-end verification is claimed. No credentials were entered and no fake live evidence was created.

Remaining coverage: full `/agents`, `/scout`, `/catalogue-review`, `/cover-review`, `/add-sale`, public collection and mobile workflow audits; per-item/bulk independence; historical snapshot implications; stale page counters; source-record correction; actual database failure/retry tests on an isolated database. Existing historical snapshots are not rewritten.

Next three priorities: (1) transactional outcome closure plus human correction of the graded record; (2) durable agent execution and reconciliation of legacy approvals; (3) benchmark-driven Scout junk reduction and coverage/diversity allocation with high-recall gates.

---

# Second tranche — 13 September 2026

Baseline `4ef7c9a`. Four commits pushed: `4f174b5`, `1f3fd15`, `2c3e4b4`, `b07a116`. Three migrations written and tested but **not applied** — see `beta-audit-resume.md` for the blocker and the held code. No production evidence was created or corrected.

## Priorities from the previous tranche

| Priority | Root cause | What shipped | Status |
| --- | --- | --- | --- |
| P0 — cross-table outcome/sale race | The sale and its audits were transactional; closing the outcome was a separate write. A crash or a concurrent decision in between left verified evidence on an outcome still in the queue, or one someone else had dismissed. | `confirm_outcome_sale` locks the outcome, checks eligibility, creates or reuses exactly one verified observation through the existing `approve_submitted_sale`, and closes the queue — one transaction. Idempotent on retry. Both eBay listing-id spellings resolved in one place. | Migration ready, **not applied** |
| P0 — graded sale with empty grading fields | No workflow existed to correct grading on an already-verified sale. Add-sale sets it at creation; sale review decides the edition match. Neither can say "this one is in a slab". | `record_observation_grading` plus a Decisions-inbox card. Refuses without an explicit source confirmation; never reads a grade from a title; refuses to rewrite grading already settled. `hasUnresolvedGrading` now accepts a settled human answer, which unblocks the raw-copy-with-graded-title case that previously had no way out. | Migration ready, **not applied**. `ff81fb2f` still needs a human. |
| P1 — 23 open approved actions | Two different bugs. Approving a machine-executable action without running it was a one-way door — the execute path only looked for `proposed`, so approval locked execution out for ever (6 actions). Human work had no completion step at all (17 actions). `status` was carrying both questions. | `execution_status` separates "has it run" from "did a human approve it". Durable leases with bounded claims; expired leases become **failed with a reason**, never succeeded. Failures keep their approval so staff do not approve the same work twice. Recovery on the existing 11:30 cron. | Migration ready, **not applied** |
| P1 — Scout junk rejection | The scorer is at its text-matching ceiling; most remaining junk looks correct on every stored field. | Reproducible benchmark harness with a stable development/holdout split. Two conservative rules measured. | **Shadow mode — deliberately not activated** |

## Scout measurement

Baseline reproduced: 822 cases (was 811), recall 571/578 = 98.79%, junk rejection 46/244 = 18.85% — junk rejection identical to the stored figure.

Where the remaining junk comes from, by the label staff gave it: graded_not_raw 48, unavailable 33, multi_volume_lot 9, edition_mismatch 8, printing_unproven 3. **A third of it is "unavailable"** — a good match on a listing that had simply gone. No title-based rule can predict that, and none should try.

| Holdout (417 unseen cases) | Before | After |
| --- | --- | --- |
| Genuine recall | 98.36% (299/304) | 98.03% (298/304) |
| Junk rejection | 17.70% (20/113) | 50.44% (57/113) |
| Genuine opportunities lost | — | **1** |

Not activated. A 33-point junk reduction is worth having, but not by silently discarding buying opportunities. `graded_slab` lost a BGS 7.0 Demon Slayer first print a human wanted; `multi_volume_lot` lost an Initial D omnibus. The holdout earned its keep: an earlier omnibus guard read only the edition's series and format and lost two opportunities, because RAR catalogues omnibus editions whose identity says so in the title or edition statement instead.

The honest fix for `graded_slab` is not a better detector. A graded copy of a tracked edition is a real opportunity in a *different* market, so it belongs in its own queue, not the bin. That is separate work.

## Legacy action reconciliation

`scripts/reconcile-open-agent-actions.mjs` reports a verdict per action against real evidence and writes nothing — bulk-labelling 23 actions "executed" would destroy the only information anyone would later want. Current verdicts: **1** to run (machine-executable, never ran), **1** whose queue is already clear, **7** genuinely live (9,605 unreviewed Scout leads among them), **14** needing a person. Three duplicate `triage_scout_leads` approvals exist because each run mints a fresh dedupe key.

## Verification and scope limits

Four PGlite suites run the shipped migration SQL against real PostgreSQL 18.3 — 59 + 33 + 48 checks plus the Scout rule tests. This establishes genuine atomicity, rollback and idempotency, which a mock cannot: a mock will happily report a rollback the engine would never have performed.

**Not established:** two simultaneous connections. PGlite is a single backend, so `for update` blocking a second session cannot be observed. Needs Docker or a real server; neither is available here.

**Not performed:** live database mutation, staff-UI end-to-end testing, phone checks. Production was read only.

## Remaining beta-readiness gaps

Status as of 13 September 2026, after Phase 1. See `beta-audit-resume.md` for the evidence behind each line.

| # | Gap | Status |
| --- | --- | --- |
| 1 | Three migrations unapplied | **Closed.** Applied and verified live, plus `20260913_beta_rpc_permissions.sql`. |
| 2 | `ff81fb2f` needs a human | **Closed.** BGS 8.5, confirmed by SP, 2026-09-13T17:39Z. |
| 3 | 23 legacy actions still open | **Recounted: 26, covering 15 distinct jobs.** The duplication cause is fixed and every action now has a disposition. 11 superseded, 1 to run, 2 closable, 2 live, 10 needing a person — all reported individually, none closed by automation. |
| 4 | Graded leads need their own queue before `graded_slab` activates | Open. A product decision, not an implementation gap; Phase 3. |
| 5 | Concurrency untested against a real multi-connection server | Open, and **blocked on infrastructure, not effort**. No PostgreSQL, Docker or psql on this machine and no database password available. Harness written and self-refusing against production; the five unproven scenarios and the exact setup are in the resume doc. |
| 6 | `/agents`, `/scout`, `/catalogue-review`, `/cover-review`, `/add-sale`, public collection and mobile unaudited | **Closed for rendering and navigation**, by 71 HTTP checks and a real browser at 1920px and 390px. Two mobile defects found and repaired. Authenticated rendering on a physical handset remains unverified — checklist in the resume doc. |
| 7 | 4 of the last 140 agent runs failed, uninvestigated | **Closed.** Window 2026-08-15 to 2026-09-13: 136 succeeded, 4 failed. All four are `market_scout` with one message — missing eBay credentials — on 20–21 August, since configured; 23 days of clean runs follow. Transient configuration, already resolved, nothing retried. |
| 8 | 1506 of 1812 listing outcomes unreachable, and every tab/queue count understated | **Closed.** Stable pagination; all ten view/queue combinations traverse every row exactly once, proved on synthetic and live data. |
| 9 | The grading card had never been seen rendering | **Closed.** Verified on an isolated fixture with the real component, route and RPC. Found and fixed a vacuous source-confirmation gate. |

| 10 | A recurring job accumulated an unbounded number of open approvals | **Closed.** Title comparison embedded a changing workload count, so a standing approval never matched its own re-proposal. Now compared with numbers normalised. |
| 11 | Reconciliation measured the wrong backlog | **Closed.** `triage_scout_leads` was judged against 9657 unreviewed leads instead of the ~110 the action was raised for — an 88× overstatement. |

Not beta-ready: gap 4 is a product decision still to be made, gap 5 is blocked on infrastructure, and the remaining `triage_scout_leads` / cover / readiness work in gap 3 is real live work needing people. No staff decision *write* has been exercised against production.
