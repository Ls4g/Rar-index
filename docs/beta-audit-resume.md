# Beta audit resume — repair tranche shipped

Baseline: main at 86f8b29. Repairs shipped in `326ad78`; mobile control follow-up in `bdbdd70`, both pushed. Historical checkpoint notes below describe the interruption; the resumed section supersedes their status. Preserve unrelated local settings.

## Implemented locally

- Outcome sale confirmation now uses the existing transactional `approve_submitted_sale` RPC instead of separate insert/review calls. Explicit human copy-type confirmation; company and grade required for graded copies; Best Offer corroboration and sale type retained. Queue closure is conditional and retryable, without re-verifying existing evidence. Duplicate matches to another edition or excluded/unverified observations are refused. Canonical numeric eBay listing ID used across intake paths.
- Background outcome checks now exclude human-reviewed rows, condition updates on status/attempt count/reviewer, require successful audit writes, and surface queue-read failures. Staff outcome decisions also condition writes and protect all prior human reviews.
- Shadow-test retries reevaluate an existing candidate rather than returning it unevaluated. Partial Scout scan failures no longer report executed; returning the proposal preserves approval metadata.
- Portfolio queries fetch grading and printing fields. Shared calculations exclude graded/unresolved grading from raw holdings, split printing groups, match specific printing numbers, avoid duplicated metrics for repeated holdings, select one supported currency group instead of summing currency medians, and withhold whole-portfolio gains when costs/evidence are incomplete. Generic publications use the most-supported raw printing group. Holding badge now names the actual evidence group rather than always claiming first print.
- Price-series construction excludes unresolved grading conflicts without editing source observations or human decisions.

## Live read-only findings (2026-09-12 17:51 UTC)

- All four latest daily agent runs succeeded; Curator staged 2 candidates.
- 23 approved actions remain open, including older scan and shadow-test approvals. This lifecycle backlog is NOT repaired yet. No proposed actions at that snapshot.
- Outcome statuses: 723 active; 918 ended_pending_check; 87 unsold; 15 ambiguous; 5 sold_candidate; 22 review_complete; 4 inaccessible.
- Nine outcome-origin sales. One verified observation has a graded title but empty grading fields: `ff81fb2f-201d-4ef1-85db-74171ae76b2a`, “Hunter x Hunter #1 … BGS 8.5 … Japanese Manga 1998 US SELLER”. Requires HUMAN source inspection/correction. Do not infer or write its grade from its title. No production evidence was changed.
- Latest stored Scout benchmark: 811 cases; recall 560/567 = 98.7654%; junk rejection 46/244 = 18.8525%. Scorer and activation gates unchanged by this work.

## Validation completed

- New `test-outcome-sale-confirmation.mjs`: passed, including stateful mock DB failure/retry, raw/graded, Best Offer, canonical ID, duplicate protection. Not a live mutation test.
- New `test-shadow-test-retry.mjs`: passed, exercising production evaluator orchestration with mock DB.
- New `test-portfolio-evidence.mjs`: passed before the final comparison-label edit. Covers grading, printing separation, currency alternatives, duplicate holdings, snapshot/card agreement, missing costs and FX.
- New `test-outcome-worker-races.mjs`: passed, including late human decision and audit/provider/queue failure paths.
- Existing watch-to-sale, price-series, eBay item-ID, agent-reliability and Scout phase-four tests passed BEFORE the final worker/portfolio edits. Rerun affected checks.
- Lint passed with two pre-existing EditionCover `<img>` warnings BEFORE later edits.
- Direct `node node_modules/typescript/bin/tsc --noEmit` passed after printing-group implementation, BEFORE final comparison-label/HoldingCard change.
- `corepack pnpm exec tsc --noEmit` failed to locate tsc despite installation; direct entry point worked.
- Full production build passed once outside sandbox (Google font download blocked sandbox build), BEFORE later edits. Final build REQUIRED.
- Production public home inspected with real covers. Staff route redirected to login. No credentials entered. Staff/mobile UI and actual live mutation workflows NOT visually/end-to-end verified.
- Browser ambient context at interruption now says `/review`; inspect the current tab because staff access may now be available. Do not assume it is authenticated.

## Files changed / added

Existing: `app/api/agents/route.ts`, `app/api/listing-outcomes/route.ts`, `components/ListingOutcomesPanel.tsx`, `components/PortfolioClient.tsx`, `components/portfolio/HoldingCard.tsx`, `lib/portfolioSnapshot.ts`, `lib/portfolioValuation.ts`, `lib/priceSeries.ts`, `lib/scoutRuleEvaluation.ts`, `lib/watchToSale.ts`, `package.json`.

Added: `components/OutcomeSaleConfirmationForm.tsx`, `lib/outcomeSaleConfirmation.ts`, `lib/gradingEvidence.ts`, `scripts/audit-beta-baseline.mjs`, the four regression scripts above, and this resume file. No migration was added or applied.

## Next commands and investigations

1. `git status --short`, then `node node_modules/typescript/bin/tsc --noEmit`. Review the entire diff, especially final portfolio comparison labels, conditional outcome writes, and canonical-ID duplicate handling.
2. Run the four new regression scripts plus affected existing workflow tests; run final lint and production build. Use `corepack pnpm` with Node on PATH; build needs network access for the configured font.
3. Inspect current browser `/review` session. Verify staff approval form against real records without creating fake evidence. Test desktop/mobile and refresh/queue closure using an authorized legitimate human decision or a safe isolated DB. If unavailable, explicitly report rendering/live mutation unverified and request a phone check under AGENTS.md.
4. Review remaining risks: cross-table outcome/sale race still needs a transactional outcome-closure migration; approved agent actions lack a durable execution lease/recovery path; old portfolio snapshots remain historical calculations; other valuation summaries may need the same unresolved-grading protection; general-publication most-supported-group selection needs clear visible explanation. Do not claim beta readiness yet.
5. Finish audit report with P0/P1 root causes, measured evidence and precise remaining gaps. Commit only task files, then PUSH IMMEDIATELY as AGENTS.md requires. Check deployment status. Nothing from this session has shipped yet.

Reproduce live baseline read-only: `node --env-file=.env.local scripts/audit-beta-baseline.mjs` (approved network command). Credentials stay in environment and are not printed.

## Resumed on 13 September 2026

Both confirmation entry points now share the form: added changes in `app/review/page.tsx` and `components/HumanDecisionInbox.tsx`. Authenticated production review access is available. No sale decisions submitted.

Final workflow suite (32 scripts), direct TypeScript, lint and production build passed. Two existing image warnings remain. Lint, TypeScript and production build also passed after the mobile-only follow-up. See `docs/beta-audit-findings.md` for priorities, acceptance criteria and explicit outstanding scope.

Authenticated deployed `/review` and `/listing-outcomes` forms were exercised against real Jujutsu Kaisen candidates without submitting decisions. Raw selection enables confirmation; empty/graded-without-details stays disabled; selections were reset. Real viewport override confirmed 390px mobile rendering without horizontal overflow. This exposed undersized controls, repaired with 44px minimum heights and full-card form width. No actual phone or live mutation test was performed.

Vercel reported success for both `326ad78` and `bdbdd70`. Final deployed control sizes and desktop/mobile rendering were checked; temporary viewport override was reset. All implementation changes are committed/pushed; this checkpoint update is documentation only.

Next investigation: `Get-Content lib/outcomeSaleConfirmation.ts`, then inspect the `approve_submitted_sale` migration and add an outcome-aware transactional closure with an isolated database concurrency test. Preserve human source verification. Subsequently reconcile the 23 legacy approved actions through durable execution recovery. Full remaining page audit and Scout benchmark optimization are outstanding. No schema migration was applied in this tranche.
