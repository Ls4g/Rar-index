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

Authenticated production `/review` was inspected with real listings. Public home was inspected earlier. New interface rendering, desktop/mobile interactions and deployment are checked separately after shipping; no claim of human sale verification or live mutation end-to-end completion is made. No credentials were entered and no fake live evidence was created.

Remaining coverage: full `/agents`, `/scout`, `/catalogue-review`, `/cover-review`, `/add-sale`, public collection and mobile workflow audits; per-item/bulk independence; historical snapshot implications; stale page counters; source-record correction; actual database failure/retry tests on an isolated database. Existing historical snapshots are not rewritten.

Next three priorities: (1) transactional outcome closure plus human correction of the graded record; (2) durable agent execution and reconciliation of legacy approvals; (3) benchmark-driven Scout junk reduction and coverage/diversity allocation with high-recall gates.
