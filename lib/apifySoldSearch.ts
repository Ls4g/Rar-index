import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOutcomeRow,
  classifyApifyRow,
  indexEditionsByIsbn,
  normaliseIsbnKey,
  type ApifyEbayRow,
  type IntakeEdition,
} from "./apifyListingIntake.ts";
import type { ScoutRule } from "./scoutRules.ts";

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
export const DAILY_BATCH_RESULTS_PER_SERIES = 5;
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
 * One search, for one ISBN, capped.
 *
 * Runs synchronously and waits, because the caller is a person who clicked a
 * button and needs to know what happened. The actor finishes in a few seconds
 * for a single keyword.
 */
export async function runSoldSearch(token: string, isbn: string): Promise<SoldSearchResult> {
  const input = {
    categoryId: "0",
    count: RESULTS_PER_SEARCH,
    daysToScrape: SEARCH_DAYS,
    ebaySite: "ebay.com",
    includeCompletedListings: false,
    itemCondition: "any",
    itemLocation: "default",
    keywords: [isbn],
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
  const rows = (await response.json()) as ApifyEbayRow[];
  const runId = response.headers.get("x-apify-pagination-total") ?? "";
  return { rows: Array.isArray(rows) ? rows.slice(0, RESULTS_PER_SEARCH) : [], runId, costUsd: 0 };
}

export function soldSearchBatchRunUrl(): string {
  const url = new URL(`https://api.apify.com/v2/actors/${APIFY_SOLD_ACTOR}/runs`);
  url.searchParams.set("timeout", "120");
  url.searchParams.set("maxItems", String(DAILY_BATCH_RESULTS_PER_SERIES * MAX_DAILY_BATCH_SERIES));
  url.searchParams.set("maxTotalChargeUsd", MAX_DAILY_BATCH_CHARGE_USD.toFixed(2));
  url.searchParams.set("restartOnError", "false");
  return url.toString();
}

/** One paid run searches up to six ISBNs, with the actor's per-keyword count. */
export async function runSoldSearchBatch(token: string, isbns: string[]): Promise<SoldSearchResult> {
  if (!isbns.length || isbns.length > MAX_DAILY_BATCH_SERIES || new Set(isbns).size !== isbns.length
    || isbns.some((isbn) => isbnForSearch(isbn) !== isbn)) {
    throw new Error("A scheduled search needs one to six distinct ISBNs.");
  }
  const headers = { Authorization: `Bearer ${token}` };
  const start = await fetch(soldSearchBatchRunUrl(), {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      categoryId: "0", count: DAILY_BATCH_RESULTS_PER_SERIES, daysToScrape: SEARCH_DAYS,
      ebaySite: "ebay.com", includeCompletedListings: false, itemCondition: "any",
      itemLocation: "default", keywords: isbns, sortOrder: "endedRecently",
      subcategoryId: "", buyingFormat: "all",
    }),
  });
  if (!start.ok) throw new Error(`The scheduled sold-listing batch failed (HTTP ${start.status}).`);
  const started = (await start.json()) as { data?: { id?: string } };
  const runId = started.data?.id;
  if (!runId || !/^[A-Za-z0-9]+$/.test(runId)) throw new Error("Apify did not return a batch run ID.");

  let run: { status?: string; usageTotalUsd?: number | null } = {};
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?waitForFinish=60`, { headers });
    if (!response.ok) throw new Error(`The scheduled sold-listing batch could not be checked (HTTP ${response.status}).`);
    run = ((await response.json()) as { data?: typeof run }).data ?? {};
    if (run.status === "SUCCEEDED") break;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status ?? "")) {
      throw new Error(`The scheduled sold-listing batch ended as ${run.status}.`);
    }
  }
  if (run.status !== "SUCCEEDED") throw new Error("The scheduled sold-listing batch did not finish in time.");
  if (typeof run.usageTotalUsd === "number" && run.usageTotalUsd > MAX_DAILY_BATCH_CHARGE_USD + 0.0001) {
    throw new Error("The scheduled sold-listing batch exceeded its charge ceiling.");
  }

  const output = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?limit=${DAILY_BATCH_RESULTS_PER_SERIES * isbns.length}`, { headers });
  if (!output.ok) throw new Error(`The scheduled sold-listing batch results could not be read (HTTP ${output.status}).`);
  const rows = (await output.json()) as ApifyEbayRow[];
  if (!Array.isArray(rows)) throw new Error("Apify returned invalid batch results.");
  const requested = new Set(isbns);
  if (rows.some((row) => !requested.has(normaliseIsbnKey(row.keyword)))) {
    throw new Error("Apify returned a listing without a requested ISBN keyword.");
  }
  // Apify warns that the first terminal response may show preliminary costs.
  const latest = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers }).catch(() => null);
  if (latest?.ok) {
    const refreshed = await latest.json().catch(() => null) as { data?: typeof run } | null;
    if (typeof refreshed?.data?.usageTotalUsd === "number") run = refreshed.data;
  }
  if (typeof run.usageTotalUsd === "number" && run.usageTotalUsd > MAX_DAILY_BATCH_CHARGE_USD + 0.0001) {
    throw new Error("The scheduled sold-listing batch exceeded its charge ceiling.");
  }
  return { rows, runId, costUsd: run.usageTotalUsd ?? null };
}

export type QueueOutcome = {
  found: number;
  queued: number;
  needsHuman: number;
  dropped: number;
  alreadyKnown: number;
  dropReasons: string[];
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
): Promise<QueueOutcome> {
  const byIsbn = indexEditionsByIsbn(editions);
  const result: QueueOutcome = { found: rows.length, queued: 0, needsHuman: 0, dropped: 0, alreadyKnown: 0, dropReasons: [] };

  const toInsert = [];
  for (const row of rows) {
    const decision = classifyApifyRow(row, byIsbn, rules);
    if (decision.kind === "human") { result.needsHuman += 1; continue; }
    if (decision.kind === "drop") {
      result.dropped += 1;
      if (!result.dropReasons.includes(decision.why)) result.dropReasons.push(decision.why);
      continue;
    }
    toInsert.push(buildOutcomeRow(row, decision.pick, sourceId));
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
