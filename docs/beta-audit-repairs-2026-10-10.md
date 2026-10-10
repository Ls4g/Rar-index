# Beta audit repairs — 10 October 2026

## Release

Implementation commit: `22b5c9c3cf984b7d8a513cfcd899bea9c691aa34`.
Pushed to `main` and `codex/beta-audit-repairs`. Vercel production deployment
`B6zm9U1fJRi9149iDHwZTZWDuXAn` reported Ready and assigned
`rar-index.vercel.app` on 10 October at 11:17 BST.

## Six findings addressed

1. Homepage sales now carry `listing_title` and `grading_reviewed_at` into the
   existing chart safeguards. A regression demonstrates that two raw sales
   plus one unresolved graded title cannot become a three-sale raw chart.
2. Portfolio snapshots read complete, stably ordered pages of essential inputs
   and abort on failures, including failure to read the previous snapshot.
3. Outcome workers reserve shared daily capacity before provider calls, stop
   if reservation accounting is unavailable, and refund only unattempted work.
   Manual and scheduled endpoints return 503 when the budget is unavailable.
   The recent due-row selection and human-review protections are retained.
4. Approval closure uses the existing locked database function, which records
   closure and its audit in one transaction. Claimed work must finish or be
   recovered before closure; execution owners are unique per request.
5. Catalogue review has stable pagination, direct candidate loading,
   deduplication and explicit load errors. Out-of-range links clamp to the
   last page without requesting an invalid database offset. Current discovery
   and publisher-link improvements are retained.
6. The previously preview-only graded-sale recognition fix `ed4ddf2` is included
   in this production release. Recognising an existing verified sale changes
   queue presentation, not its original human decisions or evidence.

## Database verification

Restored the existing additive migration files dated 20260924 for closure and
outcome budgets. Read live definitions through the Supabase SQL editor:
`close_agent_action`, `reserve_outcome_checks`, and `settle_outcome_checks`
already match the restored definitions. All three allow service-role execution
and deny anon/authenticated execution. No migration reapplication was needed.
Read-only verification query: `ef860594-07b8-4b8d-ada8-450bcb9e5a19`.

## Validation and remaining checks

- All 51 scripts in `test:workflows` passed. This includes restored failure,
  transactional rollback, budget and traversal tests plus graded and buying
  search tests that were previously outside the main suite.
- Full lint passed. TypeScript passed via the installed compiler directly
  because `corepack pnpm exec tsc` could not locate its executable. The final
  production build, including its TypeScript phase, passed.
- The final pagination adjustment was checked against an out-of-range error
  fixture, linted and included in the final successful production build.
- Production homepage and real chart data rendered in the browser. A 390px
  viewport had no page-width overflow. This was browser emulation, not a handset.
- Staff session expired before live catalogue and graded-queue verification.
  The user was asked to sign in; no password was requested or entered by the
  agent. Staff rendering is still unverified for this release.
- Two-connection concurrency tests remain excluded by the user's earlier
  instruction. PGlite tests are single-session checks, not concurrency proof.
- No genuine sale evidence or human review decisions were created or altered.
  Existing unrelated untracked files were preserved.

## Exact resume

After the user signs into the existing RAR browser tab:
1. Open `/catalogue-review`, check the pagination controls and an out-of-range
   page link. If the real queue is empty, report that; do not create candidates
   to populate it. Complete traversal is covered by the 123-row local fixture.
2. Open `/graded-revisit`, confirm recorded-sale recognition and inspect the
   already-revisited view without submitting decisions. Recount live matches
   before using yesterday's queue numbers.
3. Check these staff pages at desktop and narrow browser widths; restore the
   viewport afterwards. A real-handset check remains separate.
4. Record the observed results. Do not repeat the entire suite unless code
   changes or a new failure justify it. No need to reapply the verified SQL.
