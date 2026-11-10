import { runRecordedCron, summarizeCronResponse } from "@/lib/cronHeartbeat";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadActiveScoutRules } from "@/lib/scoutRules";
import { selectScheduledSearchTargets, configuredDailySearchLimit, SCHEDULED_SALE_COLUMNS } from "@/lib/dailyApifySearch";
import {
  buildScheduledSoldSearchPlan, hasSearchReserve, isbnForSearch, MAX_DAILY_BATCH_CHARGE_USD, MAX_DAILY_BATCH_SERIES,
  MIN_REMAINING_USD, queueDiscoveredListings, readApifyBudget, runScheduledEditionSearch, scheduledRunChargeCeilingUsd,
  SCHEDULED_RUN_CONCURRENCY, SEARCH_COOLDOWN_HOURS,
} from "@/lib/apifySoldSearch";
import {
  failedOutcome, formatLastError, formatWarnings, problemFromError, runBounded, summariseRuns,
  type EditionRunOutcome, type SearchFailureCode, type SearchProblem,
} from "@/lib/apifyRunLog";
import type { IntakeEdition } from "@/lib/apifyListingIntake";
import type { CoverageEdition } from "@/lib/editionPriceCoverage";
import type { SeriesSale } from "@/lib/priceSeries";
import type { SalesInboxOutcome } from "@/lib/salesInbox";
import type { SupabaseClient } from "@supabase/supabase-js";

// Discovery only. The existing eBay check and human decision remain the only
// route from these leads to a verified sale. No price is published here.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Actor work must stop this long after the invocation starts, leaving
// maxDuration headroom for queueing, the search log and the heartbeat.
const SEARCH_DEADLINE_MS = 230_000;
// A run with less than this left cannot finish, so it is not started (and
// costs nothing); it is recorded as time_budget instead.
const MIN_RUN_START_MS = 45_000;
// A run that has fetched its rows gets this long past the deadline to queue them.
const QUEUE_GRACE_MS = 20_000;

const EDITION_COLUMNS = "id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no";
const OUTCOME_COLUMNS = "edition_id,status,discovery_provider:original_snapshot->>provider,reviewed_by,resulting_observation_id,check_attempts,next_check_at";
const SEARCH_LOG_COLUMNS = "isbn_13,requested_edition_id,last_started_at,last_status,last_result_count";
async function readPages<T>(admin: SupabaseClient, table: string, columns: string, configure: (query: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => ReturnType<ReturnType<SupabaseClient["from"]>["select"]>, orderColumn = "id") {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await configure(admin.from(table).select(columns))
      .order(orderColumn, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(`${table} could not be read: ${error.message}`);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorised." }, { status: 401 });
  }
  const invokedAt = Date.now();
  // Filled by the job; read after runRecordedCron returns.
  const detail: { apify: ReturnType<typeof summariseRuns> | null } = { apify: null };

  const response = await runRecordedCron("apify-sales", getSupabaseAdmin, async (admin) => {
    const limit = configuredDailySearchLimit(process.env.APIFY_DAILY_SEARCH_LIMIT);
    if (!limit) return Response.json({ ok: true, configured: false, searched: 0, queued: 0 });
    const token = process.env.APIFY_TOKEN;
    if (!token) return Response.json({ ok: false, error: "Apify is not configured." }, { status: 503 });

    const [editions, sales, outcomes, recentSearches, sourceResult, rules] = await Promise.all([
      readPages<CoverageEdition>(admin, "manga_editions", EDITION_COLUMNS,
        (query) => query.eq("is_verified", true)),
      readPages<SeriesSale & { edition_id: string }>(admin, "price_observations", SCHEDULED_SALE_COLUMNS,
        (query) => query.eq("match_status", "verified_match").eq("sale_status", "confirmed").eq("is_verified", true)),
      readPages<SalesInboxOutcome & { edition_id: string }>(admin, "listing_outcomes", OUTCOME_COLUMNS,
        (query) => query.in("status", ["ended_pending_check", "sold_candidate", "ambiguous", "inaccessible"])
          .is("reviewed_by", null).is("resulting_observation_id", null)
          .or("status.neq.ambiguous,check_attempts.lt.5,next_check_at.not.is.null")),
      readPages<{ isbn_13: string; requested_edition_id: string | null; last_started_at: string; last_status: string; last_result_count: number | null }>(admin, "price_coverage_search_cooldowns", SEARCH_LOG_COLUMNS,
        (query) => query, "isbn_13"),
      admin.from("sources").select("id").eq("name", "eBay Sold").maybeSingle(),
      loadActiveScoutRules(admin),
    ]);
    if (sourceResult.error || !sourceResult.data?.id) {
      return Response.json({ ok: false, error: "The eBay Sold source is unavailable." }, { status: 503 });
    }
    const sourceId = sourceResult.data.id as string;

    const candidates = selectScheduledSearchTargets(editions, sales, outcomes,
      recentSearches, new Date(), Math.min(limit, MAX_DAILY_BATCH_SERIES));
    if (!candidates.length) return Response.json({ ok: true, configured: true, searched: 0, queued: 0 });

    const budget = await readApifyBudget(token).catch(() => null);
    if (!budget || !hasSearchReserve(budget, MAX_DAILY_BATCH_CHARGE_USD)) {
      return Response.json({ ok: false, configured: true, searched: 0, queued: 0,
        error: budget ? `Apify balance is below the $${(MIN_REMAINING_USD + MAX_DAILY_BATCH_CHARGE_USD).toFixed(2)} reserve.` : "Apify balance could not be read." }, { status: 503 });
    }

    const claimed: typeof candidates = [];
    let cooldowns = 0;
    // Each claimed ISBN gets its own outcome: status, result count and, on a
    // failure or warning, a `code: sentence` line in last_error.
    const finishOne = async (outcome: EditionRunOutcome) => {
      const lastError = outcome.failure ? formatLastError(outcome.failure, outcome.warnings) : formatWarnings(outcome.warnings);
      const { error } = await admin.from("price_coverage_search_cooldowns")
        .update({ last_finished_at: new Date().toISOString(), last_status: outcome.status,
          last_result_count: outcome.status === "succeeded" ? outcome.found : null, last_error: lastError })
        .eq("isbn_13", outcome.isbn);
      if (error) console.error(JSON.stringify({ event: "apify_search_log_unfinished", isbn: outcome.isbn }));
    };
    const failAll = async (problem: SearchProblem<SearchFailureCode>) => {
      const failed = claimed.map((target) => failedOutcome(target, problem));
      await Promise.all(failed.map(finishOne));
      return failed;
    };

    // Reserve the UTC day's single paid claim (p_daily_limit: 1). Each ISBN also gets its
    // existing atomic cooldown, so a simultaneous staff click cannot duplicate it.
    for (const target of candidates) {
      if (claimed.length >= MAX_DAILY_BATCH_SERIES) break;
      if (!claimed.length) {
        const { data: claim, error } = await admin.rpc("claim_scheduled_apify_search", {
          p_isbn_13: target.isbn, p_edition_id: target.editionId,
          p_daily_limit: 1, p_cooldown_hours: SEARCH_COOLDOWN_HOURS,
        });
        if (error || !["claimed", "cooldown", "daily_limit"].includes(claim)) {
          return Response.json({ ok: false, configured: true, searched: 0, queued: 0,
            error: "The scheduled search cost guard is unavailable." }, { status: 503 });
        }
        if (claim === "daily_limit") return Response.json({ ok: true, configured: true, searched: 0, queued: 0 });
        if (claim === "cooldown") { cooldowns += 1; continue; }
      } else {
        const { data: claim, error } = await admin.rpc("claim_price_coverage_search", {
          p_isbn_13: target.isbn, p_edition_id: target.editionId,
          p_cooldown_hours: SEARCH_COOLDOWN_HOURS,
        });
        if (error) {
          // Stop claiming more, but still search what is already claimed:
          // those ISBNs are reserved and the day's slot is spent either way.
          console.error(JSON.stringify({ event: "apify_cooldown_claim_unavailable", isbn: target.isbn }));
          break;
        }
        if (!claim) { cooldowns += 1; continue; }
      }
      claimed.push(target);
    }
    if (!claimed.length) return Response.json({ ok: true, configured: true, searched: 0, queued: 0, cooldowns });

    console.info(JSON.stringify({ event: "apify_daily_selection", targets: claimed.map((target) => ({
      edition_id: target.editionId, reason: target.reason,
    })) }));

    let results: EditionRunOutcome[];
    const { data: siblings, error: siblingError } = await admin.from("manga_editions")
      .select(EDITION_COLUMNS).in("isbn_13", claimed.map((target) => target.isbn));
    if (siblingError) {
      // Checked before any paid run starts, so nothing is spent.
      results = await failAll({ code: "variants_unreadable",
        message: "The editions sharing this ISBN could not be read, so no actor run was started." });
    } else {
      const variantsByIsbn = new Map<string, IntakeEdition[]>();
      for (const sibling of (siblings ?? []) as unknown as IntakeEdition[]) {
        const key = isbnForSearch(sibling.isbn_13);
        if (key) variantsByIsbn.set(key, [...(variantsByIsbn.get(key) ?? []), sibling]);
      }
      const maxChargeUsd = scheduledRunChargeCeilingUsd(claimed.length);
      const deadlineAt = invokedAt + SEARCH_DEADLINE_MS;
      const budgetExpired = () => Date.now() >= deadlineAt;
      results = await runBounded(claimed, {
        concurrency: SCHEDULED_RUN_CONCURRENCY, deadlineAt, minStartMs: MIN_RUN_START_MS, graceMs: QUEUE_GRACE_MS,
      }, async (target, signal) => {
        const edition = editions.find((item) => item.id === target.editionId) as IntakeEdition | undefined;
        if (!edition) {
          return failedOutcome(target, { code: "edition_missing", message: "The selected edition could not be read; no actor run was started." });
        }
        let plan;
        try {
          plan = buildScheduledSoldSearchPlan([edition]);
        } catch {
          return failedOutcome(target, { code: "invalid_plan", message: "RAR could not build a search for this edition; no actor run was started." });
        }
        let search;
        try {
          search = await runScheduledEditionSearch(token, plan, { maxChargeUsd, deadlineAt, signal });
        } catch (error) {
          return failedOutcome(target, problemFromError(error, budgetExpired()));
        }
        try {
          const queued = await queueDiscoveredListings(admin, search.rows,
            variantsByIsbn.get(target.isbn) ?? [edition], rules, sourceId, plan);
          const dropCounts = { ...search.dropCounts };
          for (const [code, count] of Object.entries(queued.dropCounts)) dropCounts[code] = (dropCounts[code] ?? 0) + count;
          const outcome: EditionRunOutcome = {
            editionId: target.editionId, isbn: target.isbn, reason: target.reason,
            status: "succeeded", failure: null, warnings: search.warnings,
            found: search.rows.length, queued: queued.queued, alreadyKnown: queued.alreadyKnown,
            needsHuman: queued.needsHuman, costUsd: search.costUsd, dropCounts,
            ambiguousItemIds: queued.ambiguousItemIds,
          };
          return outcome;
        } catch (error) {
          const problem = problemFromError(error, false);
          return failedOutcome(target, { code: "queue_failed",
            message: `The run's results could not be queued. ${problem.message}` },
          { costUsd: search.costUsd, found: search.rows.length, dropCounts: search.dropCounts, warnings: search.warnings });
        }
      }, (target, started) => failedOutcome(target, { code: "time_budget", message: started
        ? "RAR's time budget for the daily search ran out before this edition finished."
        : "RAR's time budget for the daily search ran out before this edition's run could start; nothing was spent on it." }),
      (target, error) => failedOutcome(target, problemFromError(error, budgetExpired())));
      await Promise.all(results.map(finishOne));
    }

    const summary = summariseRuns(results);
    for (const outcome of results) {
      if (outcome.failure) {
        console.error(JSON.stringify({ event: "apify_edition_search_failed", edition_id: outcome.editionId,
          code: outcome.failure.code, error: outcome.failure.message }));
      }
    }
    detail.apify = summary;
    // ok stays true while at least one edition succeeded; `failed` > 0 marks
    // the heartbeat "partial". Every edition failing is a 502 as before.
    const allFailed = summary.succeeded === 0;
    return Response.json({
      ok: !allFailed, configured: true,
      searched: summary.searched, seriesSearched: summary.searched,
      succeeded: summary.succeeded, failed: summary.failed,
      found: summary.found, queued: summary.queued, alreadyKnown: summary.alreadyKnown,
      needsHuman: summary.needsHuman, dropped: summary.dropped,
      cooldowns, spentUsd: summary.spentUsd,
      dropCounts: summary.dropCounts, failureCodes: summary.failureCodes, warningCodes: summary.warningCodes,
      runs: summary.runs, ambiguousPrinting: summary.ambiguousPrinting,
      ...(allFailed ? { error: "Every scheduled sold-listing search failed; see runs for each reason." } : {}),
    }, { status: allFailed ? 502 : 200 });
  });

  // runRecordedCron keeps only whitelisted numeric keys in the heartbeat, which
  // is why the failures before 11 November left no reason anywhere. Merge the
  // bounded per-edition detail (codes, counts, our own sentences; no payloads,
  // no tokens) into the same summary row. Best effort: never fails the job.
  const runId = response.headers.get("X-RAR-Cron-Run");
  if (detail.apify && runId && response.headers.get("X-RAR-Cron-Recorded") === "true") {
    try {
      const body = await response.clone().json() as Record<string, unknown>;
      const base = summarizeCronResponse("apify-sales", response.status, body);
      const { error } = await getSupabaseAdmin().from("cron_invocations")
        .update({ summary: { ...base.summary, ...flattenCounts(detail.apify), apify: detail.apify } })
        .eq("id", runId).abortSignal(AbortSignal.timeout(3000));
      if (error) throw new Error("detail write failed");
    } catch {
      console.error(JSON.stringify({ event: "apify_cron_detail_unrecorded", id: runId }));
    }
  }
  return response;
}

/** Flat numeric copies, so simple summary queries need no jsonb paths. */
function flattenCounts(summary: ReturnType<typeof summariseRuns>) {
  const flat: Record<string, number> = {
    succeeded: summary.succeeded, failed: summary.failed, needsHuman: summary.needsHuman, dropped: summary.dropped,
  };
  for (const [code, count] of Object.entries(summary.dropCounts)) flat[`drop_${code}`] = count;
  for (const [code, count] of Object.entries(summary.failureCodes)) flat[`fail_${code}`] = count;
  return flat;
}
