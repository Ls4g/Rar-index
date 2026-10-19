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

// One search returns at most this many listings. eBay rarely has more recent
// sales than this for a single manga volume, and a cap is the only thing
// standing between a stuck loop and a spent account.
export const RESULTS_PER_SEARCH = 25;

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

export type SoldSearchResult = { rows: ApifyEbayRow[]; runId: string; costUsd: number };

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

  // run-sync-get-dataset-items starts the run, waits, and returns the rows in
  // one call, so there is no polling loop that could spin.
  const response = await fetch(
    `https://api.apify.com/v2/acts/${APIFY_SOLD_ACTOR}/run-sync-get-dataset-items?timeout=120`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) {
    throw new Error(`The sold-listing search failed (HTTP ${response.status}). Nothing was queued.`);
  }
  const rows = (await response.json()) as ApifyEbayRow[];
  const runId = response.headers.get("x-apify-pagination-total") ?? "";
  return { rows: Array.isArray(rows) ? rows : [], runId, costUsd: 0 };
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
