import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOutcomeRow,
  classifyApifyRow,
  indexEditionsByIsbn,
  normaliseIsbnKey,
  buildTitleSearchOutcomeRow,
  rowDisqualification,
  type ApifyEbayRow,
  type IntakeEdition,
  autoDismissReasons,
  autoDismissedOutcomeRow,
  AUTO_DISMISS_REVIEWER,
} from "./apifyListingIntake.ts";
import type { ScoutRule } from "./scoutRules.ts";
import {
  sanitiseDiagnostic,
  SoldSearchFailure,
  type SearchFailureCode,
  type SearchProblem,
  type SearchWarningCode,
} from "./apifyRunLog.ts";

// Running a sold-listing search for one edition, and queueing what comes back.
//
// This is the half of the Apify work that touches the outside world: it spends
// money and it writes rows. The judgement about whether a listing is the right
// edition lives in apifyListingIntake.ts, which is pure and tested on its own.
//
// Nothing here concludes that anything sold. Apify's sold flag only echoes the
// search filter that produced the row -- it has returned listings whose own
// page says the seller ended them -- so every queued row goes in as
// `ended_pending_check` and is resolved afterwards by eBay's own item data or
// by a person reading the page.

// caffein.dev/ebay-sold-listings. The alternative actor was tried and
// rejected: it reported 48 of 49 rows as sold and 0 as unsold, because its
// sold field echoed the search filter rather than the item.
export const APIFY_SOLD_ACTOR = "oTtB3VgfuE9GtxQt2";

// The Actor's own `count` is only a requested result count. The API request
// also sets maxItems and a run-level dollar ceiling; neither output size nor
// a timeout alone is a spending guarantee.
export const RESULTS_PER_SEARCH = 25;
export const MAX_SEARCH_CHARGE_USD = 0.12;
// Four results per scheduled edition, using one query per edition.
export const DAILY_BATCH_RESULTS_PER_SERIES = 4;
export const MAX_DAILY_BATCH_SERIES = 6;
// One scheduled run per UTC day stays below the staff-requested $0.15 ceiling.
export const MAX_DAILY_BATCH_CHARGE_USD = 0.14;

// How far back a search looks. Also the window `PRICE_CURRENT_WITHIN_DAYS`
// uses for "current", deliberately: a price RAR quotes should be refreshable
// by the same search that found it.
export const SEARCH_DAYS = 90;

// Refuse to start a run when less than this is left on the account. A run that
// begins and cannot finish still charges for what it fetched.
export const MIN_REMAINING_USD = 0.5;

// A second search for the same edition this soon afterwards would almost
// certainly return the same listings and charge again for them.
export const SEARCH_COOLDOWN_HOURS = 12;

export type ApifyBudget = { usedUsd: number; maxUsd: number; remainingUsd: number };

export function hasSearchReserve(budget: ApifyBudget, maxChargeUsd = MAX_SEARCH_CHARGE_USD): boolean {
  return budget.remainingUsd >= MIN_REMAINING_USD + maxChargeUsd;
}

export async function readApifyBudget(token: string): Promise<ApifyBudget> {
  const response = await fetch("https://api.apify.com/v2/users/me/limits", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Apify would not report the account balance (HTTP ${response.status}).`);
  const data = ((await response.json()) as { data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } } }).data ?? {};
  const usedUsd = data.current?.monthlyUsageUsd ?? 0;
  const maxUsd = data.limits?.maxMonthlyUsageUsd ?? 0;
  return { usedUsd, maxUsd, remainingUsd: Math.max(0, maxUsd - usedUsd) };
}

export type SoldSearchResult = { rows: ApifyEbayRow[]; runId: string; costUsd: number | null };

export type SoldSearchPlan = {
  keywords: string[];
  queryToIsbn: Map<string, string>;
  titleTargets: Map<string, IntakeEdition>;
};

export function titleVolumeLanguageMangaQuery(edition: IntakeEdition): string | null {
  if (edition.collectible_type === "zasshi") return null;
  const series = edition.series?.trim();
  const volume = String(edition.volume_number ?? "").trim();
  const language = edition.language?.trim();
  if (!series || !volume || !language || !/^(English|Japanese)$/i.test(language)) return null;
  return `${series} Vol ${volume} ${language} manga`;
}

export function buildSoldSearchPlan(editions: IntakeEdition[]): SoldSearchPlan {
  const keywords: string[] = [];
  const queryToIsbn = new Map<string, string>();
  const titleTargets = new Map<string, IntakeEdition>();
  const collisions = new Set<string>();
  for (const edition of editions) {
    const isbn = isbnForSearch(edition.isbn_13);
    if (!isbn || queryToIsbn.has(isbn)) throw new Error("Search targets need distinct valid ISBNs.");
    keywords.push(isbn);
    queryToIsbn.set(isbn, isbn);
    const query = titleVolumeLanguageMangaQuery(edition);
    if (!query) continue;
    if (collisions.has(query)) continue;
    if (titleTargets.has(query)) {
      collisions.add(query);
      continue;
    }
    titleTargets.set(query, edition);
  }
  for (const query of collisions) titleTargets.delete(query);
  // Keep each pair together so a capped actor run does not starve later series.
  const paired = keywords.flatMap((isbn) => {
    const query = [...titleTargets].find(([, edition]) => isbnForSearch(edition.isbn_13) === isbn)?.[0];
    return query ? [isbn, query] : [isbn];
  });
  for (const [query, edition] of titleTargets) queryToIsbn.set(query, isbnForSearch(edition.isbn_13)!);
  return { keywords: paired, queryToIsbn, titleTargets };
}

/** The Actor accepts at most six keywords, so the daily six-edition batch uses one each. */
export function buildScheduledSoldSearchPlan(editions: IntakeEdition[]): SoldSearchPlan {
  const full = buildSoldSearchPlan(editions);
  const titleByIsbn = new Map([...full.titleTargets].map(([query, edition]) => [isbnForSearch(edition.isbn_13), query]));
  const keywords = editions.map((edition) => {
    const isbn = isbnForSearch(edition.isbn_13)!;
    return titleByIsbn.get(isbn) ?? isbn;
  });
  const queryToIsbn = new Map(keywords.map((query) => [query, full.queryToIsbn.get(query)!]));
  const titleTargets = new Map([...full.titleTargets].filter(([query]) => queryToIsbn.has(query)));
  return { keywords, queryToIsbn, titleTargets };
}

export function soldSearchRunUrl(): string {
  const url = new URL(`https://api.apify.com/v2/acts/${APIFY_SOLD_ACTOR}/run-sync-get-dataset-items`);
  url.searchParams.set("timeout", "120");
  url.searchParams.set("maxItems", String(RESULTS_PER_SEARCH));
  url.searchParams.set("maxTotalChargeUsd", MAX_SEARCH_CHARGE_USD.toFixed(2));
  url.searchParams.set("restartOnError", "false");
  url.searchParams.set("limit", String(RESULTS_PER_SEARCH));
  return url.toString();
}

/**
 * One capped run, searching the ISBN and a complementary title phrase.
 *
 * Runs synchronously and waits, because the caller is a person who clicked a
 * button and needs to know what happened. The actor finishes in a few seconds
 * for a single keyword.
 */
export async function runSoldSearch(token: string, plan: SoldSearchPlan): Promise<SoldSearchResult> {
  if (!plan.keywords.length || plan.keywords.length > 2) throw new Error("One edition is required for a manual search.");
  const input = {
    categoryId: "0",
    count: plan.keywords.length === 2 ? 12 : RESULTS_PER_SEARCH,
    daysToScrape: SEARCH_DAYS,
    ebaySite: "ebay.com",
    includeCompletedListings: false,
    itemCondition: "any",
    itemLocation: "default",
    keywords: plan.keywords,
    sortOrder: "endedRecently",
    subcategoryId: "",
    buyingFormat: "all",
  };

  // Apify enforces maxTotalChargeUsd at run level for every pricing model.
  // maxItems additionally limits charged items for pay-per-result Actors.
  const response = await fetch(soldSearchRunUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(`The sold-listing search failed (HTTP ${response.status}). Nothing was queued.`);
  }
  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows)) throw new Error("Apify returned results that were not a list. Nothing was queued.");
  // A row outside the requested phrases is dropped on its own; it no longer
  // discards the valid rows the same paid run returned.
  const { kept } = filterRequestedRows(rows, plan, RESULTS_PER_SEARCH);
  const runId = response.headers.get("x-apify-pagination-total") ?? "";
  return { rows: kept, runId, costUsd: 0 };
}

// ---------------------------------------------------------------------------
// Scheduled daily search: one independent actor run per edition.
//
// Until 10 November 2026 the cron sent every selected edition to ONE actor
// run, so any problem with any edition (or with the combined input) discarded
// all of them, and the only record was "failed". Each edition now gets its own
// small run under the same single daily claim, its own charge ceiling (the
// daily ceiling divided between them, so the total cannot rise), its own
// outcome and its own stored reason.

/** Two runs at a time: enough to finish six inside the budget, gentle on Apify. */
export const SCHEDULED_RUN_CONCURRENCY = 2;
/** The actor's own run timeout, unchanged from the batch run. */
export const SCHEDULED_ACTOR_TIMEOUT_SECONDS = 120;
/** One status poll waits at most this long (Apify caps waitForFinish at 60). */
export const SCHEDULED_POLL_WAIT_SECONDS = 60;
/** Polls allowed per run: 3 x 60 s comfortably covers the 120 s actor timeout. */
export const SCHEDULED_MAX_POLLS = 3;
/** Any single HTTP request to Apify that is not a long poll. */
export const SCHEDULED_REQUEST_TIMEOUT_MS = 20_000;

export function scheduledRunChargeCeilingUsd(runCount: number): number {
  const runs = Math.max(1, Math.min(MAX_DAILY_BATCH_SERIES, Math.floor(runCount) || 1));
  // Floor to 1/100 cent so the sum of per-run ceilings never exceeds the day's.
  return Math.floor((MAX_DAILY_BATCH_CHARGE_USD / runs) * 10_000) / 10_000;
}

export function soldSearchEditionRunUrl(maxChargeUsd: number, keywordCount = 1): string {
  const url = new URL(`https://api.apify.com/v2/actors/${APIFY_SOLD_ACTOR}/runs`);
  url.searchParams.set("timeout", String(SCHEDULED_ACTOR_TIMEOUT_SECONDS));
  url.searchParams.set("maxItems", String(DAILY_BATCH_RESULTS_PER_SERIES * keywordCount));
  url.searchParams.set("maxTotalChargeUsd", maxChargeUsd.toFixed(4));
  url.searchParams.set("restartOnError", "false");
  return url.toString();
}

/** Actor input for a scheduled run. Same filters as the old batch run. */
export function scheduledActorInput(plan: SoldSearchPlan) {
  return {
    categoryId: "0", count: DAILY_BATCH_RESULTS_PER_SERIES, daysToScrape: SEARCH_DAYS,
    ebaySite: "ebay.com", includeCompletedListings: false, itemCondition: "any",
    itemLocation: "default", keywords: plan.keywords, sortOrder: "endedRecently",
    subcategoryId: "", buyingFormat: "all",
  };
}

/**
 * Keep the rows that belong to this search; count the rest by reason.
 *
 * A row whose keyword was not requested used to throw away the whole batch.
 * It is now dropped on its own, so one odd row (for example a placeholder the
 * actor emits for a keyword with no results) cannot cost the good ones.
 */
export function filterRequestedRows(rows: unknown[], plan: SoldSearchPlan, cap = Number.POSITIVE_INFINITY) {
  const kept: ApifyEbayRow[] = [];
  const dropCounts: Record<string, number> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      dropCounts.invalid_row = (dropCounts.invalid_row ?? 0) + 1;
      continue;
    }
    const keyword = (row as ApifyEbayRow).keyword;
    if (typeof keyword !== "string" || !plan.queryToIsbn.has(keyword)) {
      dropCounts.unexpected_keyword = (dropCounts.unexpected_keyword ?? 0) + 1;
      continue;
    }
    if (kept.length >= cap) {
      dropCounts.over_result_cap = (dropCounts.over_result_cap ?? 0) + 1;
      continue;
    }
    kept.push(row as ApifyEbayRow);
  }
  return { kept, dropCounts };
}

async function apifyErrorDetail(response: Response): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { type?: unknown; message?: unknown } } | null;
  const type = typeof body?.error?.type === "string" ? body.error.type : "";
  const message = typeof body?.error?.message === "string" ? body.error.message : "";
  const detail = sanitiseDiagnostic([type, message].filter(Boolean).join(": "), 160);
  return detail ? ` Apify said: ${detail}` : "";
}

export type EditionSearchResult = {
  rows: ApifyEbayRow[];
  runId: string;
  costUsd: number | null;
  dropCounts: Record<string, number>;
  warnings: SearchProblem<SearchWarningCode>[];
};

export type EditionSearchOptions = {
  maxChargeUsd: number;
  /** Epoch ms; past this the search stops and reports `time_budget`. */
  deadlineAt: number;
  signal?: AbortSignal;
  now?: () => number;
};

/**
 * One capped actor run for one edition. Throws SoldSearchFailure with a code
 * on every failure path; returns the valid rows otherwise.
 *
 * A charge above the ceiling is a warning, not a failure: the money is already
 * spent, and discarding the rows it bought would only waste it.
 */
export async function runScheduledEditionSearch(
  token: string,
  plan: SoldSearchPlan,
  options: EditionSearchOptions,
): Promise<EditionSearchResult> {
  const now = options.now ?? Date.now;
  const isbns = [...new Set(plan.queryToIsbn.values())];
  if (isbns.length !== 1 || !plan.keywords.length || plan.keywords.length > 2
    || plan.keywords.some((keyword) => !plan.queryToIsbn.has(keyword)) || isbnForSearch(isbns[0]) !== isbns[0]) {
    throw new SoldSearchFailure("invalid_plan", "A scheduled run needs exactly one edition with a valid ISBN.");
  }
  const headers = { Authorization: `Bearer ${token}` };
  const outer = options.signal;
  const remaining = () => options.deadlineAt - now();
  const budgetGone = () => remaining() <= 0 || Boolean(outer?.aborted);
  const signalFor = (ms: number) => {
    const timeout = AbortSignal.timeout(Math.max(1, Math.min(ms, remaining())));
    return outer ? AbortSignal.any([outer, timeout]) : timeout;
  };
  const call = async (url: string, init: RequestInit, ms: number, failCode: SearchFailureCode, what: string) => {
    if (budgetGone()) throw new SoldSearchFailure("time_budget", `RAR's time budget ran out before ${what}.`);
    try {
      return await fetch(url, { ...init, signal: signalFor(ms) });
    } catch (error) {
      if (budgetGone()) throw new SoldSearchFailure("time_budget", `RAR's time budget ran out while ${what}.`);
      const name = (error as { name?: unknown } | null)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new SoldSearchFailure("request_timeout", `Apify did not answer in time while ${what}.`);
      }
      throw new SoldSearchFailure(failCode, `The request to Apify failed while ${what}.`);
    }
  };

  const start = await call(soldSearchEditionRunUrl(options.maxChargeUsd, plan.keywords.length), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(scheduledActorInput(plan)),
  }, SCHEDULED_REQUEST_TIMEOUT_MS, "start_http_error", "starting the actor run");
  if (!start.ok) {
    throw new SoldSearchFailure("start_http_error",
      `Apify refused to start the run (HTTP ${start.status}).${await apifyErrorDetail(start)}`);
  }
  const started = await start.json().catch(() => null) as { data?: { id?: string } } | null;
  const runId = started?.data?.id;
  if (!runId || !/^[A-Za-z0-9]+$/.test(runId)) {
    throw new SoldSearchFailure("no_run_id", "Apify accepted the request but returned no usable run id.");
  }

  type RunState = { status?: string; statusMessage?: string | null; usageTotalUsd?: number | null };
  let run: RunState = {};
  try {
    for (let attempt = 0; attempt < SCHEDULED_MAX_POLLS; attempt += 1) {
      const wait = Math.max(1, Math.min(SCHEDULED_POLL_WAIT_SECONDS, Math.floor((remaining() - 5_000) / 1000)));
      const response = await call(`https://api.apify.com/v2/actor-runs/${runId}?waitForFinish=${wait}`, { headers },
        wait * 1000 + SCHEDULED_REQUEST_TIMEOUT_MS, "poll_http_error", "waiting for the actor run");
      if (!response.ok) {
        throw new SoldSearchFailure("poll_http_error", `The run's status could not be read (HTTP ${response.status}).`);
      }
      run = ((await response.json().catch(() => null)) as { data?: RunState } | null)?.data ?? {};
      if (run.status === "SUCCEEDED") break;
      const terminal = { FAILED: "actor_failed", ABORTED: "actor_aborted", "TIMED-OUT": "actor_timed_out" } as const;
      const code = terminal[run.status as keyof typeof terminal];
      if (code) {
        const said = sanitiseDiagnostic(run.statusMessage ?? "", 160);
        throw new SoldSearchFailure(code, `The actor run ended as ${run.status}.${said ? ` Apify said: ${said}` : ""}`);
      }
      if (budgetGone()) throw new SoldSearchFailure("time_budget", "RAR's time budget ran out while the actor was still running.");
    }
    if (run.status !== "SUCCEEDED") {
      throw new SoldSearchFailure("not_finished",
        `The actor run was still ${run.status ?? "in an unknown state"} after ${SCHEDULED_MAX_POLLS} status checks.`);
    }
  } catch (error) {
    // Stop a run RAR has given up on, so it cannot keep charging. Best effort
    // with its own short timeout: the cron's own signal may already be spent.
    if (error instanceof SoldSearchFailure && ["time_budget", "not_finished", "request_timeout", "poll_http_error"].includes(error.code)) {
      await fetch(`https://api.apify.com/v2/actor-runs/${runId}/abort`, {
        method: "POST", headers, signal: AbortSignal.timeout(5_000),
      }).catch(() => null);
    }
    throw error;
  }

  const limit = DAILY_BATCH_RESULTS_PER_SERIES * plan.keywords.length;
  const output = await call(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?limit=${limit}`, { headers },
    SCHEDULED_REQUEST_TIMEOUT_MS, "dataset_http_error", "reading the run's results");
  if (!output.ok) {
    throw new SoldSearchFailure("dataset_http_error", `The run's results could not be read (HTTP ${output.status}).`);
  }
  const rawRows = await output.json().catch(() => null) as unknown;
  if (!Array.isArray(rawRows)) throw new SoldSearchFailure("invalid_dataset", "Apify returned results that were not a list.");
  const { kept, dropCounts } = filterRequestedRows(rawRows, plan, limit);

  // Apify warns that the first terminal response may show preliminary costs.
  if (remaining() > 2_000) {
    const latest = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, {
      headers, signal: signalFor(SCHEDULED_REQUEST_TIMEOUT_MS),
    }).catch(() => null);
    if (latest?.ok) {
      const refreshed = await latest.json().catch(() => null) as { data?: RunState } | null;
      if (typeof refreshed?.data?.usageTotalUsd === "number") run = refreshed.data;
    }
  }
  const costUsd = typeof run.usageTotalUsd === "number" && Number.isFinite(run.usageTotalUsd) ? run.usageTotalUsd : null;
  const warnings: SearchProblem<SearchWarningCode>[] = [];
  if (costUsd === null) {
    warnings.push({ code: "cost_unknown", message: "Apify did not report what this run cost." });
  } else if (costUsd > options.maxChargeUsd + 0.0001) {
    warnings.push({ code: "charge_ceiling",
      message: `The run cost $${costUsd.toFixed(4)}, above its $${options.maxChargeUsd.toFixed(4)} ceiling; its results were kept because the charge cannot be undone.` });
  }
  return { rows: kept, runId, costUsd, dropCounts, warnings };
}

export type QueueOutcome = {
  found: number;
  queued: number;
  needsHuman: number;
  dropped: number;
  alreadyKnown: number;
  dropReasons: string[];
  /** Rows dropped, counted by stable code (see RowDropCode). */
  dropCounts: Record<string, number>;
  /**
   * eBay item ids not queued because their ISBN covers two printings and the
   * title does not say which. Counted in needsHuman. They are NOT inserted:
   * a listing_outcomes row is tied to one edition_id and nothing in the review
   * flow can move it to the other printing, so attaching it to either would
   * risk a sale on the wrong printing. Surfaced in the cron summary instead.
   */
  ambiguousItemIds: string[];
  /**
   * Title-search results closed by RAR Auto-Triage (see autoDismissReasons)
   * instead of being queued for a person. Stored and audited, not dropped.
   */
  autoDismissed: number;
};

/**
 * Classify a batch and insert the survivors.
 *
 * The upsert ignores duplicates on (marketplace, external_id), the same guard
 * captureWatchedListings uses, so re-running a search can never rewrite a row
 * a person has already decided about.
 */
export async function queueDiscoveredListings(
  admin: SupabaseClient,
  rows: ApifyEbayRow[],
  editions: IntakeEdition[],
  rules: ScoutRule[],
  sourceId: string,
  plan?: SoldSearchPlan,
): Promise<QueueOutcome> {
  const byIsbn = indexEditionsByIsbn(editions);
  const result: QueueOutcome = {
    found: rows.length, queued: 0, needsHuman: 0, dropped: 0, alreadyKnown: 0, dropReasons: [], dropCounts: {}, ambiguousItemIds: [],
    autoDismissed: 0,
  };
  const nowIso = new Date().toISOString();
  const toDismiss: { row: Record<string, unknown>; reasons: string[] }[] = [];
  const drop = (code: string, why: string) => {
    result.dropped += 1;
    result.dropCounts[code] = (result.dropCounts[code] ?? 0) + 1;
    if (!result.dropReasons.includes(why)) result.dropReasons.push(why);
  };

  const toInsert = [];
  // If one eBay item appears in both queries, the ISBN-scored lead takes
  // precedence over the provisional text hit under the unique item key.
  const rankedRows = [...rows].sort((left, right) =>
    Number(Boolean(plan?.titleTargets.has(left.keyword ?? "")))
    - Number(Boolean(plan?.titleTargets.has(right.keyword ?? ""))));
  for (const row of rankedRows) {
    const titleTarget = plan?.titleTargets.get(row.keyword ?? "");
    if (titleTarget) {
      // A text hit has no edition identity. Keep it visible as a provisional
      // lead for a person, including conflicts, rather than silently deciding.
      const unusable = rowDisqualification(row);
      if (!unusable) {
        const built = buildTitleSearchOutcomeRow(row, titleTarget, rules, sourceId);
        const reasons = autoDismissReasons(built.match_assessment as { conflicts: string[] }, row.title ?? "", titleTarget);
        if (reasons.length) toDismiss.push({ row: autoDismissedOutcomeRow(built, reasons, nowIso), reasons });
        else toInsert.push(built);
      } else {
        drop(unusable.code, unusable.why);
      }
      continue;
    }
    const decision = classifyApifyRow(row, byIsbn, rules);
    if (decision.kind === "human") {
      result.needsHuman += 1;
      if (row.itemId) result.ambiguousItemIds.push(String(row.itemId));
      continue;
    }
    if (decision.kind === "drop") {
      drop(decision.code, decision.why);
      continue;
    }
    toInsert.push(buildOutcomeRow(row, decision.pick, sourceId));
  }

  if (toDismiss.length) {
    const { data: dismissed, error } = await admin
      .from("listing_outcomes")
      .upsert(toDismiss.map((entry) => entry.row), { onConflict: "marketplace,external_id", ignoreDuplicates: true })
      .select("id,external_id,review_notes");
    if (error) throw new Error(`The auto-dismissed listings could not be recorded: ${error.message}`);
    result.autoDismissed = dismissed?.length ?? 0;
    result.alreadyKnown += toDismiss.length - result.autoDismissed;
    if (dismissed?.length) {
      // The same audit table a person's decision is checked against, so the
      // automation's choices sit beside theirs.
      const { error: auditError } = await admin.from("listing_outcome_checks").insert(dismissed.map((outcome) => ({
        outcome_id: outcome.id,
        provider: AUTO_DISMISS_REVIEWER,
        attempt_number: 0,
        http_status: null,
        listing_state: null,
        resulting_status: "inaccessible",
        detail: outcome.review_notes,
        raw_response: { decision: "wrong_edition", reviewed_by: AUTO_DISMISS_REVIEWER, automatic: true },
        checked_at: nowIso,
      })));
      if (auditError) console.error(JSON.stringify({ event: "auto_dismiss_audit_unrecorded", count: dismissed.length }));
    }
  }
  if (!toInsert.length) return result;

  const { data, error } = await admin
    .from("listing_outcomes")
    .upsert(toInsert, { onConflict: "marketplace,external_id", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`The listings could not be queued: ${error.message}`);

  result.queued = data?.length ?? 0;
  result.alreadyKnown = toInsert.length - result.queued;
  return result;
}

export function isbnForSearch(value: string | null | undefined) {
  const isbn = normaliseIsbnKey(value);
  return isbn.length >= 10 ? isbn : null;
}
