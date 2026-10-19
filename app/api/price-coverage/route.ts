import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { loadActiveScoutRules } from "@/lib/scoutRules";
import { SOLD_SEARCH_DISCOVERY_PROVIDER } from "@/lib/listingOutcome";
import type { IntakeEdition } from "@/lib/apifyListingIntake";
import {
  isbnForSearch,
  hasSearchReserve,
  queueDiscoveredListings,
  readApifyBudget,
  runSoldSearch,
  MAX_SEARCH_CHARGE_USD,
  MIN_REMAINING_USD,
  RESULTS_PER_SEARCH,
  SEARCH_COOLDOWN_HOURS,
  SEARCH_DAYS,
} from "@/lib/apifySoldSearch";

// "Find sales" on the price-coverage page.
//
// The page used to only report that 181 editions had no price, which left the
// person reading it with nowhere to go. This is the button: one edition, one
// sold-listing search, and the listings worth looking at queued underneath it.
//
// It spends real money on a metered account, so every guard here is about not
// spending it twice or by accident: an atomic per-ISBN cooldown, a balance
// reserve, a run-level dollar ceiling, and a staff session required to call it.
//
// It creates no evidence. Queued listings land at `ended_pending_check` and
// are still resolved by eBay's own item data or by a person reading the page.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EDITION_COLUMNS =
  "id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no";

const EBAY_SOLD_SOURCE_NAME = "eBay Sold";

function recentSearchResponse() {
  return Response.json({
    ok: true,
    found: 0,
    queued: 0,
    alreadyKnown: 0,
    dropped: 0,
    needsHuman: 0,
    alreadySearched: true,
    summary: `This ISBN was searched within the last ${SEARCH_COOLDOWN_HOURS} hours. No new paid search was started; review the existing findings.`,
  });
}

export async function POST(request: Request) {
  if (!await isStaffRequest(request)) {
    return Response.json({ error: "Staff access is required." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: string; editionId?: string };
  if (body.action !== "find-sales") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  const editionId = (body.editionId ?? "").trim();
  if (!editionId) return Response.json({ error: "No edition was named." }, { status: 400 });

  const token = process.env.APIFY_TOKEN;
  if (!token) {
    return Response.json({ error: "APIFY_TOKEN is not configured on the server, so no search can run." }, { status: 503 });
  }

  const admin = getSupabaseAdmin();

  const { data: edition, error: editionError } = await admin
    .from("manga_editions").select(EDITION_COLUMNS).eq("id", editionId).maybeSingle();
  if (editionError) return Response.json({ error: "The edition could not be read." }, { status: 500 });
  if (!edition) return Response.json({ error: "That edition does not exist." }, { status: 404 });

  // The search is by ISBN, because that is the only thing that ties a listing
  // to a specific edition. A title search would return the whole series.
  const isbn = isbnForSearch((edition as { isbn_13: string | null }).isbn_13);
  if (!isbn) {
    return Response.json({
      error: "This edition has no ISBN, so a sold-listing search cannot identify it. Add the ISBN first, or record a sale by hand.",
    }, { status: 422 });
  }

  // Preserve the historical guard for listings queued before the dedicated
  // search log existed. The atomic claim below also covers empty/failed runs.
  const cooldownSince = new Date(Date.now() - SEARCH_COOLDOWN_HOURS * 3_600_000).toISOString();
  const { count: recentCount } = await admin
    .from("listing_outcomes")
    .select("id", { count: "exact", head: true })
    .eq("edition_id", editionId)
    .eq("outcome_provider", SOLD_SEARCH_DISCOVERY_PROVIDER)
    .gte("first_seen_at", cooldownSince);
  if ((recentCount ?? 0) > 0) {
    return recentSearchResponse();
  }

  let budget;
  try {
    budget = await readApifyBudget(token);
  } catch {
    return Response.json({ error: "Apify would not report the account balance, so no search was started." }, { status: 502 });
  }
  if (!hasSearchReserve(budget)) {
    return Response.json({
      error: `Only $${budget.remainingUsd.toFixed(2)} is left on the Apify account. RAR needs $${(MIN_REMAINING_USD + MAX_SEARCH_CHARGE_USD).toFixed(2)} before starting a search so the $${MIN_REMAINING_USD.toFixed(2)} reserve remains untouched.`,
    }, { status: 402 });
  }

  const { data: sourceRow, error: sourceError } = await admin
    .from("sources").select("id").eq("name", EBAY_SOLD_SOURCE_NAME).maybeSingle();
  if (sourceError || !sourceRow?.id) {
    return Response.json({ error: `The "${EBAY_SOLD_SOURCE_NAME}" source is missing, so nothing could be queued.` }, { status: 500 });
  }

  // Claim the ISBN atomically before a metered run. Listing rows are not a
  // reliable cooldown record: an empty/failed search writes none, and sibling
  // editions can share the same ISBN. Fail closed if the guard is unavailable.
  const { data: claimed, error: claimError } = await admin.rpc("claim_price_coverage_search", {
    p_isbn_13: isbn,
    p_edition_id: editionId,
    p_cooldown_hours: SEARCH_COOLDOWN_HOURS,
  });
  if (claimError) {
    return Response.json({ error: "The search cost guard is unavailable, so no Apify run was started." }, { status: 503 });
  }
  if (!claimed) return recentSearchResponse();

  async function finishSearch(status: "succeeded" | "failed", found: number | null, error: string | null = null) {
    const { error: logError } = await admin.from("price_coverage_search_cooldowns")
      .update({
        last_finished_at: new Date().toISOString(),
        last_status: status,
        last_result_count: found,
        last_error: error?.slice(0, 500) ?? null,
      })
      .eq("isbn_13", isbn);
    if (logError) console.error("Price-coverage search log could not be updated:", logError.message);
  }

  let rows;
  try {
    ({ rows } = await runSoldSearch(token, isbn));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The search failed.";
    await finishSearch("failed", null, message);
    return Response.json({ error: message }, { status: 502 });
  }

  // Scored against every edition sharing this ISBN, not just the one clicked:
  // three of RAR's ISBNs carry two printings, and picking the clicked one
  // would assign a Gold Foil sale to the plain edition on request.
  const { data: siblings } = await admin.from("manga_editions").select(EDITION_COLUMNS).eq("isbn_13", isbn);
  const editions = ((siblings?.length ? siblings : [edition]) as unknown as IntakeEdition[]);

  let outcome;
  try {
    const rules = await loadActiveScoutRules(admin);
    outcome = await queueDiscoveredListings(admin, rows, editions, rules, sourceRow.id as string);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The listings could not be queued.";
    await finishSearch("failed", rows.length, message);
    return Response.json({ error: message }, { status: 500 });
  }

  await finishSearch("succeeded", rows.length);

  const after = await readApifyBudget(token).catch(() => budget);

  return Response.json({
    ok: true,
    isbn,
    resultCap: RESULTS_PER_SEARCH,
    maxChargeUsd: MAX_SEARCH_CHARGE_USD,
    searchDays: SEARCH_DAYS,
    ...outcome,
    spentUsd: Number((after.usedUsd - budget.usedUsd).toFixed(4)),
    remainingUsd: Number(after.remainingUsd.toFixed(2)),
    // Said plainly, because the number that matters to the person who clicked
    // is how many listings they now have to look at -- not how many rows a
    // scraper returned.
    summary: outcome.queued
      ? `${outcome.queued} listing${outcome.queued === 1 ? "" : "s"} queued for you to check.`
      : outcome.alreadyKnown
        ? "Every listing found was already in RAR."
        : outcome.found
          ? `${outcome.found} listings found, none usable. ${outcome.dropReasons[0] ?? ""}`.trim()
          : `No sold listings for this ISBN in the last ${SEARCH_DAYS} days.`,
  });
}
