import { assessScoutListing, type ScoutEdition } from "./scoutIngest.ts";
import type { EditionMatchAssessment } from "./editionMatch.ts";
import type { ScoutRule } from "./scoutRules.ts";
import { ebayMarketplaceFromUrl } from "./ebayEvidence.ts";
import { nextOutcomeCheckAt, SOLD_SEARCH_DISCOVERY_PROVIDER } from "./listingOutcome.ts";

// Turning Apify's eBay rows into listings RAR will ask eBay about.
//
// Apify searches eBay's sold-listings index and returns rows. Two questions
// have to be answered about each one, and running them together is how a
// wrong sale gets made:
//
//   1. Is this listing the edition we searched for?   <- this module
//   2. Did it actually sell, and for how much?        <- eBay, later
//
// Nothing here decides question 2, and nothing here writes a price, a date or
// a sale. Apify's own sold flag only echoes the search filter that produced
// the row: an item eBay's sold index returned on 16 October said, on its own
// page, that the seller had ended it because it was no longer available, on
// that same date. So a row that survives this module is queued as
// `ended_pending_check` and nothing more -- a listing worth one call to eBay's
// Trading GetItem, which reads quantitySold on the item itself. That call is
// the evidence. This module only narrows what it gets pointed at, which is
// the one thing AGENTS.md permits an automated source to do.
//
// Question 1 reuses assessScoutListing, the scorer Scout already uses to
// decide whether a live listing is worth watching, rather than forming a
// second opinion that could drift laxer than the live pipeline's.

export type ApifyEbayRow = {
  itemId?: string | null;
  title?: string | null;
  url?: string | null;
  keyword?: string | null;
  endedAt?: string | null;
  soldPrice?: string | number | null;
  soldPriceMax?: string | number | null;
  soldCurrency?: string | null;
  isBestOfferAccepted?: boolean | null;
  buyingFormat?: string | null;
  listingType?: string | null;
  bidCount?: number | null;
  fullResThumbnailUrl?: string | null;
  thumbnailUrl?: string | null;
};

export type IntakeEdition = ScoutEdition & { id: string; isbn_13: string | null };

export type ScoredEdition = { edition: IntakeEdition; assessment: EditionMatchAssessment };

export type IntakeDecision =
  | { kind: "queue"; pick: ScoredEdition; runnerUp: ScoredEdition | null }
  | { kind: "human"; why: string; candidates: ScoredEdition[] }
  | { kind: "drop"; why: string };

export function normaliseIsbnKey(value: string | null | undefined) {
  return (value ?? "").toUpperCase().replace(/[^0-9X]/g, "");
}

export function indexEditionsByIsbn(editions: IntakeEdition[]) {
  const byIsbn = new Map<string, IntakeEdition[]>();
  for (const edition of editions) {
    const key = normaliseIsbnKey(edition.isbn_13);
    if (!key) continue;
    const group = byIsbn.get(key);
    if (group) group.push(edition);
    else byIsbn.set(key, [edition]);
  }
  return byIsbn;
}

// Reasons a row is unusable whichever edition it turns out to be. These are
// about whether a price could ever be trusted, not about matching.
export function priceDisqualifier(row: ApifyEbayRow): string | null {
  if (!row.itemId) return "no eBay item id, so RAR could never check it";
  if (!row.url) return "no listing URL, so there is nothing for a reviewer to open";
  if (!row.title?.trim()) return "no listing title to match on";
  if (row.isBestOfferAccepted === true) {
    return "Best Offer accepted; the search row does not disclose what was actually paid";
  }
  if (row.soldPriceMax != null) {
    return "a price range, not one sale (eBay shows these for multi-quantity listings)";
  }
  // Confirming a sale later requires the stored item id and the stored link to
  // agree -- outcomeSaleConfirmation refuses the pair otherwise. Catching a
  // disagreement here keeps a row that could never be confirmed out of the
  // queue in the first place.
  const idInUrl = /\/itm\/(?:[^/?#]*\/)?(\d{6,})/.exec(row.url)?.[1] ?? null;
  if (idInUrl && idInUrl !== String(row.itemId)) {
    return `the link points at item ${idInUrl} but the row says ${row.itemId}`;
  }
  return null;
}

export function classifyApifyRow(
  row: ApifyEbayRow,
  editionsByIsbn: Map<string, IntakeEdition[]>,
  rules: ScoutRule[] = [],
): IntakeDecision {
  const unusable = priceDisqualifier(row);
  if (unusable) return { kind: "drop", why: unusable };

  // `keyword` is whatever the search was given. When that was an ISBN it ties
  // the row to a specific edition; anything else cannot, and says so.
  const isbn = normaliseIsbnKey(row.keyword);
  if (isbn.length < 10) {
    return { kind: "drop", why: `searched by free text ${JSON.stringify(row.keyword ?? "")}, which names no edition` };
  }
  const candidates = editionsByIsbn.get(isbn) ?? [];
  if (!candidates.length) return { kind: "drop", why: `ISBN ${isbn} is not in the catalogue` };

  const title = row.title ?? "";
  const scored = candidates
    .map((edition) => ({ edition, assessment: assessScoutListing(edition, title, rules) }))
    .sort((left, right) => right.assessment.score - left.assessment.score);

  // Scout's own threshold, deliberately. assessScoutListing reserves "strong"
  // for a title that independently supplies the ISBN, publisher or language,
  // and real eBay titles mostly supply none of them -- "One Piece, Vol. 1"
  // scores 50. Scout does not demand "strong" either: it auto-dismisses a
  // lead only on a title-text CONTRADICTION (a multi-volume lot, a different
  // volume, the wrong publisher or binding, a magazine issue sold as a book)
  // and shows a person everything else. Holding this to a higher bar than the
  // live pipeline would discard almost every genuine sale, and would buy
  // nothing: a queued row costs one eBay call, eBay decides whether it sold,
  // and a person still confirms before it becomes evidence.
  const viable = scored.filter((entry) => entry.assessment.confidence !== "conflict");
  if (!viable.length) {
    return { kind: "drop", why: scored[0].assessment.conflicts.join("; ") || "title contradicts this edition" };
  }

  // On the three ISBNs that carry two printings, a clear score gap means the
  // title named something that separates them. A tie means it did not, and
  // guessing between a first printing and a later one is exactly the kind of
  // claim that has to be a person's.
  if (viable.length > 1 && viable[0].assessment.score === viable[1].assessment.score) {
    return { kind: "human", why: "this ISBN covers two printings and the title does not say which", candidates: viable };
  }
  return { kind: "queue", pick: viable[0], runnerUp: viable[1] ?? null };
}

export type OutcomeInsert = Record<string, unknown>;

// The row RAR stores. Every field is either copied from Apify or derived from
// it; none is inferred. In particular sold_price, sold_currency and sold_at
// are left alone, because the schema reserves them for an explicit completed
// sale signal and Apify is not one.
export function buildOutcomeRow(
  row: ApifyEbayRow,
  pick: ScoredEdition,
  sourceId: string,
  fallbackMarketplace = "EBAY_US",
): OutcomeInsert {
  const url = String(row.url);
  const nowIso = new Date().toISOString();
  const endedAt = typeof row.endedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.endedAt)
    ? `${row.endedAt}T00:00:00.000Z`
    : null;

  // eBay's sold index shows a buy-it-now listing at the price it was listed
  // at, which is what asking_price means. An auction row's figure is the
  // winning bid, which is not an asking price and must not be filed as one --
  // it stays in the snapshot, where it is clearly Apify's number and not
  // RAR's.
  const buyItNow = (row.listingType ?? "") === "buy_it_now";
  const askingPrice = buyItNow && row.soldPrice != null ? Number(row.soldPrice) : null;

  return {
    source_id: sourceId,
    external_id: String(row.itemId),
    marketplace: ebayMarketplaceFromUrl(url) ?? fallbackMarketplace,
    source_listing_url: url,
    // No Scout profile exists for a listing Apify found, and the column is
    // nullable precisely so a row can exist without one.
    profile_id: null,
    edition_id: pick.edition.id,
    listing_title: String(row.title),
    image_url: row.fullResThumbnailUrl ?? row.thumbnailUrl ?? null,
    asking_price: Number.isFinite(askingPrice as number) ? askingPrice : null,
    currency: askingPrice != null ? (row.soldCurrency ?? null) : null,
    // Apify's own vocabulary, kept verbatim. Translating it into eBay Browse's
    // terms would make a scraped field look like an API one.
    buying_format: row.buyingFormat ?? row.listingType ?? null,
    bid_count: typeof row.bidCount === "number" ? row.bidCount : null,
    scheduled_end_at: endedAt,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
    original_snapshot: { provider: "apify_ebay_sold_search", item: row },
    match_assessment: pick.assessment,
    status: "ended_pending_check",
    next_check_at: nextOutcomeCheckAt(0),
    outcome_reason:
      "Apify found this listing in eBay's sold-listings search index. That index is not proof of sale -- it has returned listings the seller simply ended -- so the outcome still needs checking against eBay's own item data.",
    outcome_provider: SOLD_SEARCH_DISCOVERY_PROVIDER,
    updated_at: nowIso,
  };
}
