# Security permissions repair — 1 October 2026

User requested delegation and repair after inspecting Supabase's seven headline security errors. A delegated agent prepared the migrations and isolated tests; the parent reviewed callers, compared the live catalog, applied the migrations, and verified production permissions. Work is on `codex/rar-beta-reliability`, starting from `e26a0bc`. This checkpoint supersedes earlier statements that this repair is only local.

## Applied live

Applied these checked-in migration files through the Supabase SQL editor on project `fmzzersppzqevtwqvnbd` on 1 October, before the 08:04:52 UTC post-check:

1. `supabase/migrations/20260930_staff_rpc_permissions.sql`
2. `supabase/migrations/20260930_review_view_permissions.sql`
3. `supabase/migrations/20260930_legacy_manga_permissions.sql`

The editor was loaded through Supabase's own `sql/new?content=` mechanism, avoiding direct Monaco typing. The complete selected editor text was copied back and compared with the prepared SQL before execution. Only comments/whitespace were removed from the files. Each migration used its explicit transaction. Result: **Success. No rows returned.** Execution record: SQL editor snippet `40f8f6d3-f350-495c-8e08-42c683c164d0`. Read-only catalog audit: `62bb19c7-19a0-4c01-8e9a-be589e96c6fe`.

- RAR workflow and trigger functions, including every existing overload of the explicit names, deny direct execution to PUBLIC, anon and authenticated; service_role retains execution. Public submission forms already call their rate-limit functions through the backend. Staff HMAC authentication remains unchanged.
- Future postgres-created functions no longer inherit public execution by default. Explicit public grants require deliberate review. Existing unrelated functions are not changed.
- `price_review_queue` and `edition_readiness` are service-only, security-invoker views. All current callers use the backend admin client; the production-main review caller was checked too.
- Legacy `manga` has RLS enabled and no public access. Its single row remains intact; the live catalogue is `manga_editions` and is unchanged.
- Four public views retain intentional owner rights, gain security barriers and browser SELECT-only grants: `alpha_catalogue_v1`, `publication_print_readiness`, `publication_availability`, `public_shelf_editions`. All six view query definitions were compared before/after and were identical. Public shelf opt-in and its three-column privacy boundary remain unchanged. Do not widen portfolio RLS or switch this view blindly to invoker just to erase a warning.

## Verified live

Before: **27 of 35** public security-definer functions executable by anon and authenticated. After: **0 of 35** executable by either; **35 of 35** executable by service_role. This was checked through PostgreSQL privilege metadata, without invoking mutation functions.

Anonymous requests to `manga`, `price_review_queue`, `edition_readiness` now return **401**. Backend requests still return **200**, with counts **1**, **0**, **183** respectively. Anonymous catalogue count **135**, print-readiness count **180**, and public shelf count **0** remain unchanged and return 200. These are timestamped verification counts, not standing totals.

Supabase Security Advisor now shows **4 errors and 8 warnings**, down from **7 errors and 62 warnings**. Remaining four errors are the deliberately retained public owner-rights views listed above; they are not four unnoticed unfixed staff-access holes. Remaining eight warnings: seven mutable search paths (`set_updated_at`, `set_row_updated_at`, `enforce_print_run_depth`, `prevent_portfolio_snapshot_update`, `reject_reserved_collector_username`, `touch_agent_control_updated_at`, `touch_agent_incident_updated_at`) and leaked-password protection disabled. They were not silently dismissed or represented as fixed.

Existing separate gap: anonymous exact-count requests to `publication_availability` returned HTTP 500 both before and after this change, while backend count requests returned 200/177. Cause is not established. Do not claim the whole public availability workflow was verified, or count this pre-existing error as a new permission regression.

## Validation and boundaries

- **48 workflow scripts passed** after adding `scripts/test-database-permissions.mjs` to the normal workflow suite.
- Permission tests use isolated PGlite, real migration/view/review function definitions, and synthetic records: anonymous/authenticated rejection before mutation, backend review and audit success, staff-view reads, overload coverage, default grants, idempotent application, unrelated-function preservation, shelf opt-in/opt-out and private-field isolation, collector trigger and owner-policy enforcement.
- Full lint passed with the two existing EditionCover image warnings. Direct TypeScript check passed; `corepack pnpm exec tsc --noEmit` still has the known launcher failure. Production build passed with all 37 static pages; Google Fonts required network-enabled execution. No application runtime source changed in this tranche.
- No genuine evidence, sale, grade, review decision, Scout activation, user data or cron workflow was created/changed/executed as a test. No two-connection concurrency tests. Existing shadow rules remain in shadow.
- Database ACL/RLS changes are live immediately; no app deployment is needed for them. The working branch push does not establish that prior reliability application changes are in Production.

## Resume

Locate this repair's final commit with Git history; preserve unrelated `.claude/settings.local.json`. Continue cron/release verification and the staff/collector journey from the active beta checklist. On 30 September's live catalog inspection, `close_agent_action`, `reserve_outcome_checks`, and `settle_outcome_checks` were present and correctly denied browser execution, superseding the earlier API-schema observation. Their full definitions and current deployed application release were not re-audited during this security repair.

Prioritize remaining issues by demonstrated risk. The four public-view advisories are reviewed exceptions, while the public availability error and remaining function search paths need separate bounded investigation. Do not claim beta sign-off from the advisor count alone.
