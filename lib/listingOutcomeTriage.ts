export type TriageableOutcome = {
  status: string;
  listingTitle: string;
  askingPrice: number | null;
  currency: string | null;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  buyingFormat: string | null;
  matchScore: number | null;
  matchConflicts: string[];
  lastSeenAt: string;
  outcomeReason?: string | null;
};

export type OutcomeQueue =
  | "worth_checking"
  | "best_offer"
  | "high_value"
  | "graded"
  | "lot"
  | "conflict"
  | "parked"
  | "all";

export type OutcomeTriage = {
  worthChecking: boolean;
  isBestOffer: boolean;
  isHighValue: boolean;
  isGraded: boolean;
  isLot: boolean;
  hasEditionConflict: boolean;
  isStale: boolean;
  priority: number;
  reason: string;
};

const LOT_WORDS = /\b(?:lot|set|bundle|collection|complete\s+series|box\s*set|vol(?:ume)?s?\.?\s*\d+\s*(?:-|–|to|&|and|,)\s*\d+)\b/i;
const GRADED_WORDS = /\b(?:cgc|cbcs|bgs|beckett|psa|graded|slab(?:bed)?)\b/i;

const HIGH_VALUE: Record<string, number> = {
  USD: 100,
  GBP: 80,
  EUR: 90,
  JPY: 15_000,
  CAD: 140,
  AUD: 150,
};

function daysSince(value: string, now: Date) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (now.getTime() - timestamp) / 86_400_000);
}

function hasHighValue(value: number | null, currency: string | null) {
  if (value === null || !currency) return false;
  const threshold = HIGH_VALUE[currency.toUpperCase()];
  return threshold !== undefined && value >= threshold;
}

export function classifyListingOutcome(row: TriageableOutcome, now = new Date()): OutcomeTriage {
  const conflicts = row.matchConflicts.join(" ").toLowerCase();
  const isGraded = GRADED_WORDS.test(row.listingTitle);
  const isLot = LOT_WORDS.test(row.listingTitle) || /multi-volume|lot or set|bundle/.test(conflicts);
  const hasEditionConflict = row.matchConflicts.length > 0 && !isLot;
  const isBestOffer = row.soldPrice === null
    && (row.buyingFormat ?? "").toUpperCase().includes("OFFER")
    && ["ended_pending_check", "ambiguous", "inaccessible"].includes(row.status);
  const isHighValue = hasHighValue(row.soldPrice ?? row.askingPrice, row.soldCurrency ?? row.currency);
  const isStale = daysSince(row.lastSeenAt, now) >= 21;
  const hasVerifiedOutcome = row.status === "sold_candidate"
    && row.soldPrice !== null
    && Boolean(row.soldCurrency && row.soldAt);
  const matchScore = row.matchScore ?? 0;
  const staffObservedSold = /green sold styling|supports a sale outcome/i.test(row.outcomeReason ?? "");

  const worthChecking = hasVerifiedOutcome
    || staffObservedSold
    || (!isGraded && !isLot && !hasEditionConflict && (
      (isBestOffer && matchScore >= 50)
      || (isHighValue && matchScore >= 65)
    ));

  let reason = "Status not confirmed. Parked until stronger information appears.";
  if (hasVerifiedOutcome) reason = "Completed-sale details are present. Confirm the exact edition before publishing.";
  else if (staffObservedSold) reason = "Staff saw eBay's sold state. Add the exact paid price and date before publishing.";
  else if (isGraded) reason = "Graded copy detected. Keep it out of the raw-manga evidence workflow.";
  else if (isLot) reason = "Lot or multi-volume listing detected. It cannot price one exact edition.";
  else if (hasEditionConflict) reason = "Edition-matching conflicts need resolving before this can become evidence.";
  else if (isBestOffer) reason = "The hidden Best Offer price may be recoverable through 130point.";
  else if (isHighValue) reason = "High-value listing with a useful edition match. Worth a closer look.";
  else if (isStale) reason = "Old unresolved listing with no new sale evidence. Safely parked for now.";

  let priority = matchScore * 10;
  if (hasVerifiedOutcome) priority += 10_000;
  if (staffObservedSold) priority += 7_500;
  if (isBestOffer) priority += 2_500;
  if (isHighValue) priority += 1_000;
  if (isStale) priority -= 1_000;
  if (hasEditionConflict) priority -= 2_500;
  if (isGraded) priority -= 3_000;
  if (isLot) priority -= 3_000;

  return {
    worthChecking,
    isBestOffer,
    isHighValue,
    isGraded,
    isLot,
    hasEditionConflict,
    isStale,
    priority,
    reason,
  };
}

export function outcomeMatchesQueue(row: TriageableOutcome, queue: OutcomeQueue, now = new Date()) {
  const triage = classifyListingOutcome(row, now);
  switch (queue) {
    case "worth_checking": return triage.worthChecking;
    case "best_offer": return triage.isBestOffer;
    case "high_value": return triage.isHighValue;
    case "graded": return triage.isGraded;
    case "lot": return triage.isLot;
    case "conflict": return triage.hasEditionConflict;
    case "parked": return !triage.worthChecking;
    case "all": return true;
  }
}

export type DismissalReason = "" | "unsold" | "wrong_edition" | "not_enough_evidence" | "graded" | "lot";

export function dismissalDecision(reason: DismissalReason) {
  if (reason === "unsold") return "mark_unsold";
  if (reason === "wrong_edition") return "wrong_edition";
  if (reason === "not_enough_evidence") return "mark_ambiguous";
  return "dismiss";
}

export function dismissalNotes(reason: DismissalReason, note: string) {
  const reasonLabel: Record<Exclude<DismissalReason, "">, string> = {
    unsold: "Listing did not sell",
    wrong_edition: "Wrong edition",
    not_enough_evidence: "Not enough evidence",
    graded: "Graded listing",
    lot: "Lot or multi-volume listing",
  };
  return [reason ? `Dismissal reason: ${reasonLabel[reason]}.` : "", note.trim()].filter(Boolean).join(" ");
}
