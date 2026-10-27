import { runRecordedCron } from "@/lib/cronHeartbeat";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { loadActiveScoutRules } from "@/lib/scoutRules";
import { dailySearchTargets, distinctSeriesTargets, configuredDailySearchLimit } from "@/lib/dailyApifySearch";
import {
  hasSearchReserve, MAX_DAILY_BATCH_CHARGE_USD, MAX_DAILY_BATCH_SERIES, MIN_REMAINING_USD,
  queueDiscoveredListings, readApifyBudget, runSoldSearchBatch, SEARCH_COOLDOWN_HOURS,
} from "@/lib/apifySoldSearch";
import type { IntakeEdition } from "@/lib/apifyListingIntake";
import type { CoverageEdition } from "@/lib/editionPriceCoverage";
import type { SeriesSale } from "@/lib/priceSeries";
import type { SalesInboxOutcome } from "@/lib/salesInbox";
import type { SupabaseClient } from "@supabase/supabase-js";

// Discovery only. The existing eBay check and human decision remain the only
// route from these leads to a verified sale. No price is published here.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EDITION_COLUMNS = "id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no";
const SALE_COLUMNS = "id,edition_id,sold_date,sale_price,currency,grading_company,grade_label,print_classification,known_printing_number";
const OUTCOME_COLUMNS = "edition_id,status,discovery_provider:original_snapshot->>provider,reviewed_by,resulting_observation_id,check_attempts,next_check_at";
const SEARCH_LOG_COLUMNS = "isbn_13,last_started_at";
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

  return runRecordedCron("apify-sales", getSupabaseAdmin, async (admin) => {
    const limit = configuredDailySearchLimit(process.env.APIFY_DAILY_SEARCH_LIMIT);
    if (!limit) return Response.json({ ok: true, configured: false, searched: 0, queued: 0 });
    const token = process.env.APIFY_TOKEN;
    if (!token) return Response.json({ ok: false, error: "Apify is not configured." }, { status: 503 });

    const [editions, sales, outcomes, recentSearches, sourceResult, rules] = await Promise.all([
      readPages<CoverageEdition>(admin, "manga_editions", EDITION_COLUMNS,
        (query) => query.eq("is_verified", true)),
      readPages<SeriesSale & { edition_id: string }>(admin, "price_observations", SALE_COLUMNS,
        (query) => query.eq("match_status", "verified_match").eq("sale_status", "confirmed").eq("is_verified", true)),
      readPages<SalesInboxOutcome & { edition_id: string }>(admin, "listing_outcomes", OUTCOME_COLUMNS,
        (query) => query.in("status", ["ended_pending_check", "sold_candidate", "ambiguous", "inaccessible"])
          .is("reviewed_by", null).is("resulting_observation_id", null)
          .or("status.neq.ambiguous,check_attempts.lt.5,next_check_at.not.is.null")),
      readPages<{ isbn_13: string; last_started_at: string }>(admin, "price_coverage_search_cooldowns", SEARCH_LOG_COLUMNS,
        (query) => query, "isbn_13"),
      admin.from("sources").select("id").eq("name", "eBay Sold").maybeSingle(),
      loadActiveScoutRules(admin),
    ]);
    if (sourceResult.error || !sourceResult.data?.id) {
      return Response.json({ ok: false, error: "The eBay Sold source is unavailable." }, { status: 503 });
    }

    const candidates = distinctSeriesTargets(dailySearchTargets(editions, sales, outcomes,
      new Map(recentSearches.map((row) => [row.isbn_13, row.last_started_at]))), editions, editions.length);
    if (!candidates.length) return Response.json({ ok: true, configured: true, searched: 0, queued: 0 });

    const budget = await readApifyBudget(token).catch(() => null);
    if (!budget || !hasSearchReserve(budget, MAX_DAILY_BATCH_CHARGE_USD)) {
      return Response.json({ ok: false, configured: true, searched: 0, queued: 0,
        error: budget ? `Apify balance is below the $${(MIN_REMAINING_USD + MAX_DAILY_BATCH_CHARGE_USD).toFixed(2)} reserve.` : "Apify balance could not be read." }, { status: 503 });
    }

    const claimed: typeof candidates = [];
    let cooldowns = 0;
    const finish = async (status: "succeeded" | "failed", rows: Array<{ keyword?: string | null }> = []) => {
      const counts = new Map<string, number>();
      for (const row of rows) counts.set(row.keyword ?? "", (counts.get(row.keyword ?? "") ?? 0) + 1);
      for (const target of claimed) {
        const { error } = await admin.from("price_coverage_search_cooldowns")
          .update({ last_finished_at: new Date().toISOString(), last_status: status,
            last_result_count: status === "succeeded" ? counts.get(target.isbn) ?? 0 : null })
          .eq("isbn_13", target.isbn);
        if (error) console.error("Scheduled Apify search log could not be finished:", error.message);
      }
    };

    // Reserve exactly one paid batch for the UTC day. Each ISBN also gets its
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
          await finish("failed");
          return Response.json({ ok: false, configured: true, searched: 0, queued: 0,
            error: "An ISBN cooldown could not be reserved; no paid batch was started." }, { status: 503 });
        }
        if (!claim) { cooldowns += 1; continue; }
      }
      claimed.push(target);
    }

    try {
      const isbns = claimed.map((target) => target.isbn);
      const { rows, costUsd } = await runSoldSearchBatch(token, isbns);
      const { data: siblings, error: siblingError } = await admin.from("manga_editions")
        .select(EDITION_COLUMNS).in("isbn_13", isbns);
      if (siblingError || !siblings?.length) throw new Error("Edition variants could not be read.");
      const result = await queueDiscoveredListings(admin, rows, siblings as IntakeEdition[], rules, sourceResult.data.id);
      await finish("succeeded", rows);
      return Response.json({ ok: true, configured: true, searched: claimed.length, seriesSearched: claimed.length,
        found: rows.length, queued: result.queued, alreadyKnown: result.alreadyKnown,
        cooldowns, spentUsd: costUsd });
    } catch {
      await finish("failed");
      return Response.json({ ok: false, configured: true, searched: claimed.length, queued: 0, cooldowns,
        error: "The scheduled sold-listing batch failed; no further paid run was started." }, { status: 502 });
    }
  });
}
