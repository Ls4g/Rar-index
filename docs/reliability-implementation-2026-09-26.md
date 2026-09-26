# Reliability implementation checkpoint — 26 September 2026

User requested the review's implementation order, excluding two-connection concurrency tests. The first three implementation steps are built locally. Deployment verification is blocked; bookshelf integration remains behind that step, not silently declared complete.

Work is isolated on `codex/rar-beta-reliability`, pushed to origin. Phase 1 is `1e7b4fc`; phase 2 is `a7ba3cb`; the final metrics/budget commit also carries this checkpoint. `main` has not been advanced. Use `git log -3` on this branch for the complete commit IDs before resuming.

## Implemented

1. **Approval closure and portfolio snapshots.** `close_agent_action` locks the action, rejects outstanding execution claims, preserves approval identity/notes and closes with its audit in one transaction. Expired claims require recovery first. Execution attempts use unique owner IDs. Essential snapshot reads now fail explicitly, retrieve all pages and cannot save an empty substitute after a read failure. Previous-snapshot lookup failures also stop writes.
2. **Catalogue access.** Stable newest-first pagination with an ID tie-breaker, page jump, linked-candidate fetch/deduplication and explicit missing-link messages. Decisions links include a server-readable candidate parameter. Failed queue/identity reads show an error boundary rather than a clear queue. Auxiliary failed counts show Unavailable. Catalogue identity reads are no longer capped at 5,000.
3. **Metrics and outcome budgets.** Backlog count failures remain unknown, with an explicit warning and `availability_count_known` metric. Scout reliability labels describe benchmark replay, separating would-be auto-dismissals from low-ranked useful cases. Existing safety gates and human decisions remain unchanged. Outcome runs reserve shared capacity before provider calls; unreadable reservations stop calls. Only unattempted work is refunded, and a crash conservatively keeps its allocation until UTC rollover. Limit remains 600 per run and 2,500 per UTC day. This is an outcome-resolution limit, not a whole-application eBay HTTP quota.

## Verification

- Full `corepack pnpm run test:workflows`: **46 script invocations passed**, including the collector market guide previously omitted from this command.
- Added single-session PGlite tests for closure refusal/audit rollback/permissions and budget baseline/allocation/refund/permissions. These do **not** establish concurrent-session behavior.
- Added behavioral tests for snapshot read failures/full pagination and catalogue traversal/focus/error handling. Existing approval source checks no longer pretend to prove the removed read-then-write guard.
- `corepack pnpm run lint`: passed, two existing EditionCover image warnings.
- `corepack pnpm exec tsc --noEmit`: launcher unavailable; `node node_modules/typescript/bin/tsc --noEmit` passed.
- `corepack pnpm run build`: passed, Next.js 16.2.9, all 37 static pages generated.
- No new two-connection tests; the existing concurrency scaffold is untouched at the user's request.
- No production evidence, staff decisions or live agent workflows were changed.

## Deployment gate — NOT DEPLOYED

Apply both additive migrations through the Supabase SQL editor before merging/deploying the dependent application code:

1. `supabase/migrations/20260924_atomic_agent_action_closure.sql`
2. `supabase/migrations/20260924_outcome_check_budget.sql`

Both tested in isolated PGlite; **neither applied live**. New RPCs explicitly deny PUBLIC, anon and authenticated execution and grant service_role only. Reservation tables have RLS and no public access. Missing RPCs fail closed; deploying first would disable closure and outcome checks, so do not deploy out of order.

Native browser discovery succeeded, but Computer Use approval timed out before a dedicated verification tab opened. No authenticated UI/migration or current deployed-release verification was completed. Do not substitute compiled CSS or a passing build for those checks.

## Exact next steps

1. Restore approved browser access; apply the two migrations in explicit transactions and verify RPC grants, reservation-table RLS and function existence. Do not trigger real sale/approval mutations for testing.
2. Verify local/preview catalogue review against real data: first/last/out-of-range pages, old linked candidate, missing candidate and a simulated read failure in an isolated environment. Check the new error state, budget status and reliability labels on desktop and phone.
3. Merge/deploy only after migrations are confirmed. Match the deployed commit, then verify normal scheduled runs and an authorized real staff operation. Do not clear or manufacture production evidence.
4. Continue with the collector/staff journey and bookshelf integration from the review order. The existing prototype is unchanged in this tranche. Preserve fictional-demo labeling until actual public-shelf data is integrated and privacy/market-context behavior is verified.

Unrelated `.claude/settings.local.json` remains untracked and must not be committed. Current availability configuration remains four days and 100 leads per run; experimental Scout junk rules remain in shadow. No need to repeat completed broad checks unless code changes or new failures justify it.
