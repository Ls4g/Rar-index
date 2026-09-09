# RAR operations and recovery runbook

## Routine evidence to retain

- Vercel deployment identifier and commit SHA for each release.
- Latest scheduled-run status for Scout, listing outcomes, guarded agents, reliability evaluation, and portfolio snapshots.
- Open agent incidents and the append-only incident history.
- Migration files in `supabase/migrations/`; production schema changes must always have a matching additive migration in Git.
- Original source URLs and audit decisions for catalogue and sale evidence.

Never put `CRON_SECRET`, service-role keys, staff credentials, or OAuth tokens in a URL, ticket, screenshot, or log excerpt.

## Daily operator check

1. Open the staff agent and reliability dashboards and check the newest run time, failures, open incidents, and any circuit breaker.
2. Check Scout scans for failed profiles and whether coverage-aware selection is maintaining up to five usable live listings without exhausting the daily profile cap.
3. Check listing-outcome retries. An unresolved Best Offer price stays unresolved; it is never replaced with the visible asking price.
4. Check the human review queues for duplicates and source links before approving anything.
5. Treat a missing or stale run as an incident even when the previous run succeeded.

## Backup availability check

The repository cannot prove which Supabase backup or point-in-time-recovery features are enabled for the production project. The project owner must verify this in the Supabase dashboard and record:

- the date and time checked;
- backup type and retention actually shown by Supabase;
- the newest recoverable point;
- who can start a restore;
- where a non-production restore can be created;
- any plan limitation or support dependency.

Until that record exists, backup availability is **unverified**, not assumed.

## Recovery procedure

1. Declare the incident and record its start time, symptoms, affected tables/routes, and last known good deployment.
2. Prevent further writes only through the normal Vercel/Supabase controls and only with owner approval. Record which scheduled jobs were paused. Do not delete crons or rotate credentials as an improvised first step.
3. Preserve evidence: export relevant logs, note row counts and latest timestamps, and keep the current database untouched while selecting a recovery point.
4. Prefer a restore into a separate recovery/staging project. Never test a destructive restore against production.
5. Configure the recovery app with recovery-project credentials, then validate:
   - migration/schema version and required functions;
   - auth and row-level-security policies;
   - catalogue, edition-source, sale, holding, profile, snapshot, Scout, review-decision, agent-run, and incident row counts;
   - source URL retention and unique/deduplication constraints;
   - a signed-out privacy check and an isolated signed-in holding CRUD check;
   - valuation grouping and the full automated test/build suite.
6. Compare changes after the selected recovery point. Re-enter only evidence-backed, attributable decisions; never reconstruct sale facts from memory.
7. Present the validation record and data-loss window to the owner. Production cutover or in-place restore requires explicit owner approval.
8. After cutover, rotate any credential exposed by the incident, re-enable scheduled jobs one at a time, run read-only health checks, and record the final deployment/restore identifiers.

## Restore drill gate

A documented procedure is not a verified backup. Before wider release, perform a non-production restore drill, measure the actual recoverable point and elapsed time, and attach the result to `docs/BETA_READINESS.md`. Do not promise recovery-time or recovery-point objectives until a drill supports them.
