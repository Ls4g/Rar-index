# RAR beta readiness

Last updated: 9 September 2026

Delivery branch: `codex/beta-readiness`

Baseline deployed commit: `77f2b48f70af2569281737a909b0dcc36a45cf44`

## Decision

**Not yet ready to invite a beta cohort.** The public discovery-to-auth handoff works on mobile, the evidence UI is transparent, and the portfolio comparison-group defect is fixed with regression coverage. However, production currently has three open critical reliability incidents (sale guard, catalogue curator guard, and Scout matching), and authenticated collector CRUD/privacy, staff decision saves, backup availability, and a contact destination still require verification before invitations are sent. Real completed-sale acquisition remains a human evidence dependency and must not be replaced with active listings or automated approval.

Status meanings: **verified** was exercised or measured; **fixed** was changed and still requires the stated release checks; **blocked** needs access, evidence, or an owner decision; **unverified** was inspected but not exercised end to end.

## Collector journey and privacy

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Public home, browse, edition, portfolio, collection, and request routes at 390×844 | verified | Live `https://rar-index.vercel.app`; all six rendered with `innerWidth=390` and no horizontal document overflow. |
| Search → exact edition → add handoff | verified | Live ISBN search for `9781974710027` returned one English Jujutsu Kaisen result; the edition page showed ISBN/publisher and five verified sales; Add to collection reached `/portfolio?edition=…` and retained “you’re adding a specific manga” while signed out. |
| Evidence/live-listing distinction | verified | Edition page labels active listings as asking prices that do not affect value/chart and keeps original completed-sale links. |
| Printing-not-identified explanation | fixed | Live copy contradicted its visible chart. Local rendered verification now says these sales form a separate weaker-evidence group, require the chart minimum, and never combine with known print groups. Awaiting deployment retest. |
| Signup, login, logout, recovery | fixed | The signed-out login UI and recovery entry point were rendered locally; password recovery handling and busy states are implemented and source-tested. A real reset/login/logout cycle still needs an isolated beta account. |
| Holding add/edit/delete, quantity, optional cost, snapshots | unverified | Requires an isolated authenticated collector account and both desktop/mobile retest. |
| Portfolio totals, history, unpriced holdings | fixed | Valuation now groups by exact publication, printing class/number, raw vs graded/company/grade, and source currency; only comparable raw groups with 3+ sales qualify. Regression tests cover mixed printing, graded/raw, insufficient evidence, unknown printing, and alternative currencies. Authenticated rendered verification remains outstanding. |
| Username and opt-in public shelf | unverified | Schema view exposes only username and edition ID; public page fetches edition metadata separately. Must test publish/open signed out/make private with an isolated account. |
| Server-enforced privacy | unverified | RLS/view definitions are privacy-minimised in source. Must run cross-account/anonymous checks against isolated accounts before beta. |
| Bug report/contact | blocked | Edition-specific community reporting exists, but there is no general support/contact destination. Owner must choose an accurate monitored destination; do not invent an address. |

## Scout learning and reliability

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Similar past decisions reused | verified | Read-only production report: 811 deduplicated human decisions; 768 cases returned related examples. |
| Independent evaluation split | verified | 675 development decisions and 136 deterministic holdout decisions; duplicate captures/listing keys are grouped before splitting. |
| Normal watch/dismiss decisions feed learning | verified | Unlabelled human decisions remain analysis examples; optional reason labels refine learning without making extra data entry mandatory. |
| Duplicate labelling prevention | verified | Read path keeps the latest human decision per lead, then deduplicates by source listing + exact edition. |
| Confidence report | verified | Enough evidence: English raw 50–74 (257 samples, 90% observed match), English raw 75–89 (93, 99%), English conflict (36, 11%), Japanese raw 50–74 (76, 93%). Sparse bands are explicitly marked insufficient. No learned rules are active. |
| Actual retraining claim | verified | Current system is deterministic proposals, reusable context, holdout evaluation, and rule replay—not model retraining. Product copy must keep that distinction. |
| Staff watch/dismiss buttons and reliability controls | blocked | Read-only production records show the scheduled jobs completed, but all five latest reliability suites failed and three critical incidents are open. A fresh authenticated staff session is required to inspect inputs and exercise saves/mobile controls. Never bypass staff auth. |

## Catalogue launch selection

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Priority source list | verified | `lib/coveragePriority.ts` contains 27 ranked series and the read-only production report targets English/Japanese volume 1 publications only where real records exist. |
| Published priority Vol. 1 records | verified | 27 publication roots currently represented; 30 English/Japanese target combinations have no published record and remain explicit gaps. |
| Cover/profile/sale readiness | verified | 3 records are strong (verified cover, active profile, five comparable raw sales). Most represented roots have a verified cover and active profile but lack sale depth. |
| Duplicate/wrong-edition audit | unverified | Report shows multiple English roots for One Piece, Dragon Ball, and Bleach. Some are legitimate omnibus/library/different ISBN publications; each root still needs exact identity/order review rather than automatic merging. |
| Launch covers and sourced bios | unverified | Live flagship covers render. Series summaries must remain short and carry their existing source; selection-wide coverage needs a final report. |
| Missing-edition request | verified | Public route renders on mobile, explains human review, and does not publish directly. Submission itself was not faked. |

## Price evidence and valuation

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Current strong groups | verified | Japanese One Piece Vol. 1, English Jujutsu Kaisen Vol. 1, and Japanese Hunter × Hunter Vol. 1 each report five comparable verified raw sales. |
| Closest to five-sale target | verified | Japanese Jujutsu Kaisen, English Attack on Titan, and English Kagurabachi each need one; Japanese Attack on Titan/Bleach/Kagurabachi/Initial D and English Hunter × Hunter each need two. Acquisition and verification require working original completed-sale evidence and a human decision. |
| Chart threshold and separation | verified | `lib/priceSeries.ts` separates print class/known printing and raw vs grading company+grade; lines require at least three sales. |
| Currency/postage/Best Offer/dedup/corrections | unverified | Automated regression coverage exists; production intake and correction behavior still needs an authenticated staff end-to-end test with genuine evidence. An unknown Best Offer paid price stays unresolved. |
| Bulk approved intake | blocked | Do not create test sales. Exercise with a genuine approved batch after staff sign-in and retain original links/audit attribution. |
| Active listings excluded | verified | Live page and code keep Scout leads separate; they are buying opportunities only and do not feed charts. |

## Operations and recovery

| Item | Status | Evidence / next action |
| --- | --- | --- |
| Scheduled jobs configured | verified | `vercel.json` schedules Scout, listing outcomes, guarded agents, reliability, and portfolio snapshots daily. |
| Quotas/caps/retries/dedupe in code | verified | Scout daily profile cap 50, concurrency 4, coverage-aware selection, five public listing target, bounded lead retention, and outcome retry schedule are implemented and regression-tested. |
| Cron secret handling | fixed | Listing outcomes accepted `?secret=`; it is now Bearer-header only like the other cron routes. Awaiting deployment. |
| Latest production run health | blocked | Read-only production records show the latest scheduled operator, evidence-auditor, market-scout, and catalogue-curator runs succeeded on 9 September. The latest five reliability suites nevertheless all failed, with 4 critical sale-guard regressions, 29 critical catalogue-curator regressions, and 7 critical Scout-match regressions. Do not trigger a mutating cron merely as a health check. |
| Failure visibility | blocked | Three critical incidents are open: `reliability:evidence_sale_guard`, `reliability:catalogue_curator_guard`, and `reliability:market_scout_match`. Inspect and resolve them through the staff dashboard before release; external scheduler alert delivery is still unverified. |
| Backup availability | blocked | Plan/retention and newest recoverable point cannot be inferred from code. Owner must record what the Supabase dashboard actually provides. |
| Restore procedure | fixed | `docs/OPERATIONS_RECOVERY.md` documents a non-destructive staging restore, validation, owner-approved cutover, and drill gate. No production restore was run. |

## Invite-only beta

| Item | Status | Evidence / next action |
| --- | --- | --- |
| 10–20 collector task, feedback template, metrics, gate | fixed | Prepared in `docs/BETA_INVITE_KIT.md`. |
| Recruiting, invitations, support, real feedback | blocked | Owner action only. No invitations or messages have been sent. |

## Release gate and owner dependencies

Engineering may merge/deploy this hardening branch only after reviewing the three production critical incidents. The branch passes workflow tests, lint (two pre-existing image warnings only), TypeScript, and a full production build. Before inviting collectors, the owner must provide:

1. a fresh staff login session for Scout/reliability buttons, bulk intake, and staff mobile verification;
2. an isolated collector test account (or explicit approval to create one) for auth, holdings, recovery, and signed-out shelf privacy tests;
3. the Supabase backup/retention screen details and permission for a non-production restore drill;
4. a real monitored contact destination for general beta bug reports;
5. genuine completed-sale evidence for any requested coverage increase.

Do not mark beta ready until every critical privacy, cross-account write, exact-edition attachment, and valuation grouping check is verified and the beta-kit release gate has no open critical defect.
