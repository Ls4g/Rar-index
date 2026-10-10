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
- After the user signed in, catalogue and graded-queue rendering were checked
  on production at desktop width and 390px. No page-width overflow was observed;
  the browser viewport was restored afterwards. No review controls were submitted.
- Two-connection concurrency tests remain excluded by the user's earlier
  instruction. PGlite tests are single-session checks, not concurrency proof.
- No genuine sale evidence or human review decisions were created or altered.
  Existing unrelated untracked files were preserved.

## Completed staff verification

- `/catalogue-review?page=999` rendered page 1 safely with an empty queue.
  Three real candidates subsequently appeared during the checks; a second
  out-of-range request showed page 1 and all three, with the focused candidate
  retained. No candidates were created by this verification. Traversal beyond
  50 rows remains covered by the local 123-row fixture, not a live large queue.
- In `Already revisited`, Dragon Ball Vol. 6, eBay item `307083669140`, showed
  that its verified sale is recorded for the edition and it has left the revisit
  queue. The original graded dismissal was still shown. There was no duplicate
  sale action on that card.
- Fresh graded counts initially showed 67 distinct listings, 76 edition
  decisions, 70 to revisit and 6 revisited. On a later reload they were 2 and 74
  respectively. Other activity continued during verification; these are timed
  observations, not fixed baseline numbers. This agent submitted no decisions.
- Catalogue pagination, candidate controls, graded tabs and cards were checked
  at desktop and phone browser widths. A physical handset remains untested.
- Separate visual follow-up: the selected `Keep in review` option in the
  existing detailed catalogue form has light text on a pale background in night
  mode. This is outside the six repaired findings and was not changed here.

The previously pending staff verification is complete. Do not repeat the full
suite without code changes or a new failure. Two-connection tests remain
excluded; a physical-phone check and the contrast follow-up are separate work.
