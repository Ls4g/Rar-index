import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { loadActiveScoutRules } from "@/lib/scoutRules";
import { SOLD_SEARCH_DISCOVERY_PROVIDER } from "@/lib/listingOutcome";
import type { IntakeEdition } from "@/lib/apifyListingIntake";
import {
  isbnForSearch,
  queueDiscoveredListings,
  readApifyBudget,
  runSoldSearch,
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
// spending it twice or by accident: a per-edition cooldown, a balance check
// before the run starts, a hard result cap in the search itself, and a staff
// session required to call it at all.
//
// It creates no evidence. Queued listings land at `ended_pending_check` and
// are still resolved by eBay's own item data or by a person reading the page.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EDITION_COLUMNS =
  "id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no";

const EBAY_SOLD_SOURCE_NAME = "eBay Sold";

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

  // A second search this soon would return the same listings and be charged
  // for again. Measured against what is already queued rather than a separate
  // log, so there is no table to keep in step.
  const cooldownSince = new Date(Date.now() - SEARCH_COOLDOWN_HOURS * 3_600_000).toISOString();
  const { count: recentCount } = await admin
    .from("listing_outcomes")
    .select("id", { count: "exact", head: true })
    .eq("edition_id", editionId)
    .eq("outcome_provider", SOLD_SEARCH_DISCOVERY_PROVIDER)
    .gte("first_seen_at", cooldownSince);
  if ((recentCount ?? 0) > 0) {
    return Response.json({
      ok: true,
      found: 0,
      queued: 0,
      alreadyKnown: 0,
      dropped: 0,
      needsHuman: 0,
      alreadySearched: true,
      summary: `Searched within the last ${SEARCH_COOLDOWN_HOURS} hours. No new paid search was started; review the existing findings.`,
    });
  }

  let budget;
  try {
    budget = await readApifyBudget(token);
  } catch {
    return Response.json({ error: "Apify would not report the account balance, so no search was started." }, { status: 502 });
  }
  if (budget.remainingUsd < MIN_REMAINING_USD) {
    return Response.json({
      error: `Only $${budget.remainingUsd.toFixed(2)} is left on the Apify account. No search was started.`,
    }, { status: 402 });
  }

  const { data: sourceRow, error: sourceError } = await admin
    .from("sources").select("id").eq("name", EBAY_SOLD_SOURCE_NAME).maybeSingle();
  if (sourceError || !sourceRow?.id) {
    return Response.json({ error: `The "${EBAY_SOLD_SOURCE_NAME}" source is missing, so nothing could be queued.` }, { status: 500 });
  }

  let rows;
  try {
    ({ rows } = await runSoldSearch(token, isbn));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The search failed." }, { status: 502 });
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
    return Response.json({ error: error instanceof Error ? error.message : "The listings could not be queued." }, { status: 500 });
  }

  const after = await readApifyBudget(token).catch(() => budget);

  return Response.json({
    ok: true,
    isbn,
    resultCap: RESULTS_PER_SEARCH,
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
