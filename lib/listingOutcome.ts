// Watch-to-Sale: deciding what happened to a listing after it ended.
//
// The entire value of this pipeline is what it REFUSES to conclude. A listing
// that vanished did not necessarily sell. A listing with 14 bids did not
// necessarily sell. A page that 404s proves only that the page is gone. Sale
// evidence in RAR is a completed sale with a working source link and a real
// price, and nothing weaker may become one.
//
// So classification is deliberately asymmetric: automation may resolve an
// explicit unsold, but only an explicit completed-sale signal carrying a
// usable price and date may even become a CANDIDATE -- and a candidate is
// still just a queue entry for a human.

export const OUTCOME_STATUSES = [
  "active",
  "ended_pending_check",
  "sold_candidate",
  "unsold",
  "ambiguous",
  "inaccessible",
  "review_complete",
] as const;
export type OutcomeStatus = (typeof OUTCOME_STATUSES)[number];

// What a provider is allowed to assert. Deliberately small: a provider
// reports what the marketplace explicitly said, and this module decides what
// that means. A provider may never return "sold_candidate" itself.
export type ProviderListingState =
  | "active"
  | "completed_sold"
  | "completed_unsold"
  | "not_found"
  | "unknown";

export type OutcomeSignal = {
  provider: string;
  listingState: ProviderListingState;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  // Present on auctions. Recorded because a reviewer wants to see it, and
  // explicitly never used to infer a sale.
  bidCount: number | null;
  buyingFormat: string | null;
  // Best Offer accepted price, when the marketplace discloses it. eBay
  // usually does not: the accepted amount is private between buyer and
  // seller, which is why Best Offer stays ambiguous.
  bestOfferAccepted: boolean | null;
  scheduledEndAt: string | null;
  httpStatus: number | null;
  detail: string;
};

export type OutcomeClassification = {
  status: OutcomeStatus;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  // Written to the audit trail and shown to the reviewer, so a classification
  // can always be argued with rather than merely trusted.
  reason: string;
  // True only for a state the pipeline should stop rechecking.
  resolved: boolean;
};

function isUsablePrice(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isUsableDate(value: string | null): value is string {
  if (!value) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now() + 86_400_000;
}

// A Best Offer listing shows an asking price that is, by construction, not
// what was paid. Without the accepted amount there is no sale price, and a
// sale without a price is not evidence of anything.
function looksLikeBestOffer(signal: OutcomeSignal) {
  const format = (signal.buyingFormat ?? "").toUpperCase();
  return format.includes("BEST_OFFER") || format.includes("OFFER");
}

export function classifyListingOutcome(signal: OutcomeSignal): OutcomeClassification {
  const bids = signal.bidCount ?? 0;

  if (signal.listingState === "active") {
    return {
      status: "active",
      soldPrice: null, soldCurrency: null, soldAt: null,
      reason: `${signal.provider} reports the listing is still active.`,
      resolved: false,
    };
  }

  if (signal.listingState === "completed_sold") {
    if (looksLikeBestOffer(signal) && signal.bestOfferAccepted !== true) {
      return {
        status: "ambiguous",
        soldPrice: null, soldCurrency: null, soldAt: null,
        reason: "Best Offer listing: eBay did not disclose the accepted price, so the amount paid is unknown.",
        resolved: true,
      };
    }
    if (!isUsablePrice(signal.soldPrice) || !signal.soldCurrency) {
      return {
        status: "ambiguous",
        soldPrice: null, soldCurrency: null, soldAt: null,
        reason: `${signal.provider} indicated a completed sale but returned no usable price, so there is nothing to record.`,
        resolved: true,
      };
    }
    if (!isUsableDate(signal.soldAt)) {
      return {
        status: "ambiguous",
        soldPrice: null, soldCurrency: null, soldAt: null,
        reason: `${signal.provider} indicated a completed sale but returned no usable sale date.`,
        resolved: true,
      };
    }
    return {
      status: "sold_candidate",
      soldPrice: signal.soldPrice,
      soldCurrency: signal.soldCurrency,
      soldAt: signal.soldAt,
      reason: `${signal.provider} explicitly reported a completed sale at ${signal.soldCurrency} ${signal.soldPrice} on ${signal.soldAt}.${bids ? ` ${bids} bid${bids === 1 ? "" : "s"} recorded.` : ""}`,
      resolved: true,
    };
  }

  if (signal.listingState === "completed_unsold") {
    return {
      status: "unsold",
      soldPrice: null, soldCurrency: null, soldAt: null,
      reason: `${signal.provider} explicitly reported the listing ended without a sale.${bids ? ` ${bids} bid${bids === 1 ? "" : "s"} recorded, which does not indicate a sale.` : ""}`,
      resolved: true,
    };
  }

  // Everything below is an absence of information, and absence is never
  // evidence. A removed listing might have sold, might have been withdrawn,
  // might have breached a policy. RAR does not get to pick.
  if (signal.listingState === "not_found") {
    return {
      status: "inaccessible",
      soldPrice: null, soldCurrency: null, soldAt: null,
      reason: `The listing is no longer retrievable from ${signal.provider}. A removed listing is not proof of a sale.${bids ? ` It had ${bids} bid${bids === 1 ? "" : "s"} when last seen, which is still not proof.` : ""}`,
      resolved: true,
    };
  }

  return {
    status: "ambiguous",
    soldPrice: null, soldCurrency: null, soldAt: null,
    reason: signal.detail || `${signal.provider} could not confirm what happened to this listing.`,
    resolved: false,
  };
}

// Retry schedule for a listing whose outcome is not yet known. eBay data for
// a just-ended listing is not immediately consistent, so the first check waits
// rather than firing the moment the clock passes.
export const OUTCOME_RETRY_MINUTES = [30, 180, 720, 2880, 10_080];
export const MAX_OUTCOME_ATTEMPTS = OUTCOME_RETRY_MINUTES.length;

export function nextOutcomeCheckAt(attempts: number, from = new Date()): string | null {
  if (attempts >= MAX_OUTCOME_ATTEMPTS) return null;
  const minutes = OUTCOME_RETRY_MINUTES[attempts];
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

// A listing that has exhausted its retries without ever producing an explicit
// signal is recorded as ambiguous and left alone. It is not unsold, and it is
// certainly not sold; RAR simply never found out.
export function exhaustedOutcome(provider: string, attempts: number): OutcomeClassification {
  return {
    status: "ambiguous",
    soldPrice: null, soldCurrency: null, soldAt: null,
    reason: `${provider} never confirmed an outcome after ${attempts} checks. Recorded as unknown rather than guessed.`,
    resolved: true,
  };
}

export function isDueForCheck(row: { status: OutcomeStatus; next_check_at: string | null; scheduled_end_at: string | null }, now = Date.now()) {
  if (row.status !== "ended_pending_check" && row.status !== "active" && row.status !== "ambiguous") return false;
  // Never check a listing that has not reached its own end time. Doing so
  // burns quota to be told what RAR already knows.
  if (row.scheduled_end_at && new Date(row.scheduled_end_at).getTime() > now) return false;
  if (!row.next_check_at) return row.status === "ended_pending_check";
  return new Date(row.next_check_at).getTime() <= now;
}
