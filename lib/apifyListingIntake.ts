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
  | { kind: "drop"; why: string; code: RowDropCode };

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
// about whether a price could ever be trusted, not about matching. Each one
// carries a stable code so a scheduled run can count what it dropped.
export type RowDropCode =
  | "no_item_id" | "no_url" | "no_title" | "price_range" | "id_url_mismatch"
  | "free_text_keyword" | "isbn_not_in_catalogue" | "title_conflict";

export function rowDisqualification(row: ApifyEbayRow): { code: RowDropCode; why: string } | null {
  if (!row.itemId) return { code: "no_item_id", why: "no eBay item id, so RAR could never check it" };
  if (!row.url) return { code: "no_url", why: "no listing URL, so there is nothing for a reviewer to open" };
  if (!row.title?.trim()) return { code: "no_title", why: "no listing title to match on" };
  if (row.soldPriceMax != null) {
    return { code: "price_range", why: "a price range, not one sale (eBay shows these for multi-quantity listings)" };
  }
  // Confirming a sale later requires the stored item id and the stored link to
  // agree -- outcomeSaleConfirmation refuses the pair otherwise. Catching a
  // disagreement here keeps a row that could never be confirmed out of the
  // queue in the first place.
  const idInUrl = /\/itm\/(?:[^/?#]*\/)?(\d{6,})/.exec(row.url)?.[1] ?? null;
  if (idInUrl && idInUrl !== String(row.itemId)) {
    return { code: "id_url_mismatch", why: `the link points at item ${idInUrl} but the row says ${row.itemId}` };
  }
  return null;
}

export function priceDisqualifier(row: ApifyEbayRow): string | null {
  return rowDisqualification(row)?.why ?? null;
}

export function classifyApifyRow(
  row: ApifyEbayRow,
  editionsByIsbn: Map<string, IntakeEdition[]>,
  rules: ScoutRule[] = [],
): IntakeDecision {
  const unusable = rowDisqualification(row);
  if (unusable) return { kind: "drop", why: unusable.why, code: unusable.code };

  // `keyword` is whatever the search was given. When that was an ISBN it ties
  // the row to a specific edition; anything else cannot, and says so.
  const isbn = normaliseIsbnKey(row.keyword);
  if (isbn.length < 10) {
    return { kind: "drop", code: "free_text_keyword", why: `searched by free text ${JSON.stringify(row.keyword ?? "")}, which names no edition` };
  }
  const candidates = editionsByIsbn.get(isbn) ?? [];
  if (!candidates.length) return { kind: "drop", code: "isbn_not_in_catalogue", why: `ISBN ${isbn} is not in the catalogue` };

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
    return { kind: "drop", code: "title_conflict", why: scored[0].assessment.conflicts.join("; ") || "title contradicts this edition" };
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
  // An accepted Best Offer's search-row number is not the paid price (and
  // may not even be a useful asking price). Keep the lead, but require the
  // reviewer to read the actual accepted amount on the original eBay page.
  const buyItNow = (row.listingType ?? "") === "buy_it_now" && row.isBestOfferAccepted !== true;
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
    buying_format: row.isBestOfferAccepted === true ? "BEST_OFFER" : row.buyingFormat ?? row.listingType ?? null,
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

// Which contradictions are certain enough for the daily search to dismiss a
// title-search result on its own, without a person.
//
// Only the ones a title cannot get wrong by accident: a lot or set is never
// one copy, a magazine issue is never the book, a title in another language
// is not this edition, and a sister series is a different book. A single
// different volume number is deliberately NOT here, and neither is the
// scorer's own language conflict: English listings routinely say "Japanese
// manga", so only a language named outright (below) counts. On 13 November a
// listing titled "One Piece, Vol. 68" was in fact the Vol. 13 a reviewer
// verified from the photos -- sellers mistype volume numbers, so that case
// stays with a person. Nothing here can confirm anything: it only takes a
// result out of the queue, records why, and never touches a row a person
// has already decided (the insert ignores existing listings).
export const AUTO_DISMISS_REVIEWER = "RAR Auto-Triage";

const AUTO_DISMISS_CONFLICTS: { test: RegExp; label: string }[] = [
  { test: /multi-volume lot or set/, label: "a multi-volume lot or set" },
  { test: /magazine issue, not this book/, label: "a magazine issue, not this book" },
  { test: /different series in the same franchise/, label: "a different series in the same franchise" },
];

// Gaps in the shared detectors that the 13 November results exposed, kept
// here so they narrow only this queue and do not change Scout's behaviour:
//   - a Jump magazine issue that says "Volume" ("Weekly Shonen Jump 2015
//     Volume 12") reads as a book to the issue parser. VIZ paperbacks also
//     say "Shonen Jump", so the magazine needs a magazine word, "Weekly", or
//     a month and year beside it;
//   - volume runs written "1/2/3, 4/5/6" or "Volumes 1-2";
//   - a language named outright ("German") that is not the edition's.
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const JUMP_MAGAZINE = new RegExp(`\\bweekly\\s+(?:shonen|shounen)\\s+jump\\b|\\b(?:shonen|shounen)\\s+jump\\s+(?:magazine|issue|(?:${MONTHS})\\s+(?:19|20)\\d{2})\\b`, "i");
const VOLUME_RUN = /\b\d{1,3}\s*\/\s*\d{1,3}\s*\/\s*\d{1,3}\b|\bvol(?:ume)?s\.?\s*\d{1,3}\s*(?:-|–|to)\s*\d{1,3}\b/i;
const NAMED_LANGUAGES = ["German", "French", "Italian", "Spanish", "Portuguese", "Korean", "Chinese", "Thai", "Polish", "Dutch", "Swedish", "Russian", "Indonesian", "Vietnamese"];

export function autoDismissReasons(
  assessment: Pick<EditionMatchAssessment, "conflicts">,
  title = "",
  edition: { language?: string | null; series?: string | null } = {},
): string[] {
  const reasons = AUTO_DISMISS_CONFLICTS
    .filter((rule) => assessment.conflicts.some((conflict) => rule.test.test(conflict)))
    .map((rule) => rule.label);
  const add = (label: string) => { if (!reasons.includes(label)) reasons.push(label); };
  if (JUMP_MAGAZINE.test(title) && !/jump/i.test(edition.series ?? "")) add("a magazine issue, not this book");
  if (VOLUME_RUN.test(title)) add("a multi-volume lot or set");
  const editionLanguage = (edition.language ?? "").trim().toLowerCase();
  const named = NAMED_LANGUAGES.find((language) => new RegExp(`\\b${language}\\b`, "i").test(title));
  if (named && editionLanguage && named.toLowerCase() !== editionLanguage) add("a different language");
  return reasons;
}

/**
 * The same row a person would see, already closed as "wrong edition" (the
 * status the review page's own wrong-edition button sets), with the reviewer
 * and the reason recorded so it stays inspectable and reversible by eye.
 */
export function autoDismissedOutcomeRow(row: OutcomeInsert, reasons: string[], nowIso: string): OutcomeInsert {
  return {
    ...row,
    status: "inaccessible",
    next_check_at: null,
    reviewed_by: AUTO_DISMISS_REVIEWER,
    reviewed_at: nowIso,
    review_notes: `Dismissed automatically: the title describes ${reasons.join(" and ")}. Not reviewed by a person.`,
  };
}

export function buildTitleSearchOutcomeRow(
  row: ApifyEbayRow,
  searchedEdition: IntakeEdition,
  rules: ScoutRule[],
  sourceId: string,
): OutcomeInsert {
  const assessment = assessScoutListing(searchedEdition, row.title ?? "", rules);
  const provisionalAssessment: EditionMatchAssessment = {
    ...assessment,
    confidence: assessment.confidence === "conflict" ? "conflict" : "insufficient",
    reasons: [
      "Found by title, volume and language search; exact ISBN, publisher, printing and binding require human review.",
      ...assessment.reasons,
    ],
  };
  const outcome = buildOutcomeRow(row, { edition: searchedEdition, assessment: provisionalAssessment }, sourceId);
  return {
    ...outcome,
    original_snapshot: { provider: "apify_ebay_sold_search", search_basis: "title_volume_language_manga", item: row },
    outcome_reason: "Provisional title-search lead, not an exact-edition match or confirmed sale. A reviewer must check the original listing against this edition's ISBN, publisher, printing and binding, then verify the completed sale and paid price.",
  };
}
