import { ebayMarketplaceFromUrl, extractEbayLegacyItemId } from "./ebayEvidence.ts";
import { detectGradingEvidence } from "./submittedSale.ts";
import { outcomeIsBestOffer, storedLegacyItemId } from "./outcomeSaleConfirmation.ts";
import { listingIsMultiVolumeLot } from "./liveListings.ts";

export type SaleCheckEvidence = {
  provider: string;
  state: string | null;
  httpStatus: number | null;
  checkedAt: string;
  rawResponse: unknown;
};

export type PreparedSaleInput = {
  id: string;
  externalId: string;
  status: string;
  sourceListingUrl: string;
  listingTitle: string;
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  buyingFormat: string | null;
  matchConflicts: string[];
  checks: SaleCheckEvidence[];
};

export type PreparedSaleDecision = {
  ready: boolean;
  reason: string | null;
  price: number | null;
  currency: string | null;
  soldAt: string | null;
  grading: "raw" | "graded" | null;
  gradingCompany: string | null;
  gradeLabel: string | null;
  printing: "printing_not_identified";
  imageUrls: string[];
  itemSpecifics: Array<{ name: string; values: string[] }>;
  checkedAt: string | null;
};

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validImage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "ebayimg.com" || url.hostname.endsWith(".ebayimg.com"));
  } catch { return false; }
}

function empty(reason: string): PreparedSaleDecision {
  return {
    ready: false, reason, price: null, currency: null, soldAt: null,
    grading: null, gradingCompany: null, gradeLabel: null,
    printing: "printing_not_identified", imageUrls: [], itemSpecifics: [], checkedAt: null,
  };
}

/** A draft for a human decision, not an automated sale verification. */
export function prepareSaleDecision(input: PreparedSaleInput): PreparedSaleDecision {
  const check = input.checks.find((entry) => entry.provider === "eBay Trading GetItem");
  const wrapper = object(check?.rawResponse);
  const raw = object(wrapper?.final_response) ?? wrapper;
  const imageUrls = Array.isArray(raw?.imageUrls) ? [...new Set(raw.imageUrls.filter(validImage))].slice(0, 12) : [];
  const itemSpecifics = Array.isArray(raw?.itemSpecifics) ? raw.itemSpecifics.flatMap((entry) => {
    const value = object(entry);
    return typeof value?.name === "string" && Array.isArray(value.values)
      ? [{ name: value.name, values: value.values.filter((part): part is string => typeof part === "string") }]
      : [];
  }) : [];
  const title = typeof raw?.title === "string" && raw.title.trim() ? raw.title : input.listingTitle;
  const grade = detectGradingEvidence(title, itemSpecifics);
  const draft = {
    ...empty(""), imageUrls, itemSpecifics, checkedAt: check?.checkedAt ?? null,
    grading: grade.isGraded ? "graded" as const : "raw" as const,
    gradingCompany: grade.company || null, gradeLabel: grade.grade || null,
  };
  const needs = (reason: string): PreparedSaleDecision => ({ ...draft, ready: false, reason });

  if (input.status !== "sold_candidate") return needs("The sale and its paid amount have not been established yet.");
  if (input.matchConflicts.length) return needs(`Edition conflict: ${input.matchConflicts[0]}`);
  if ([title, input.listingTitle].some((value) => listingIsMultiVolumeLot(value, 1)
    || /\b(?:vol(?:ume)?s?\.?|bk|books?)\s*\d+(?:\s*,?\s+\d+){2,}\b/i.test(value))) {
    return needs("This may be a multi-volume lot, not one copy of the selected edition.");
  }
  if (!ebayMarketplaceFromUrl(input.sourceListingUrl)) return needs("The source is not an original eBay listing URL.");
  const itemId = extractEbayLegacyItemId(input.sourceListingUrl);
  if (!itemId || itemId !== storedLegacyItemId(input.externalId)) return needs("The original eBay link and listing ID do not match.");
  if (outcomeIsBestOffer(input.buyingFormat, input.listingTitle)) return needs("Best Offer: eBay's API does not provide the accepted amount.");
  if (!check || check.state !== "completed_sold" || check.httpStatus !== 200) {
    return needs("No current completed-sale check from eBay Trading is available.");
  }
  if (!raw || !["completed", "ended"].includes(String(raw.listingStatus ?? "").toLowerCase())) {
    return needs("The eBay check did not include a completed listing state.");
  }
  if (raw.quantitySold !== 1) return needs("This listing sold more than one copy, or its sold quantity is unknown.");
  if (raw.bestOfferEnabled === true) return needs("Best Offer: the accepted amount is not in eBay's API response.");

  const rawPrice = object(raw.price);
  const price = typeof rawPrice?.value === "number" ? rawPrice.value : null;
  const currency = typeof rawPrice?.currency === "string" ? rawPrice.currency : null;
  const soldAt = typeof raw.endTime === "string" ? raw.endTime : null;
  if (!price || !Number.isFinite(price) || !currency || !soldAt || !input.soldAt
    || Math.abs(price - Number(input.soldPrice)) > 0.005
    || currency !== input.soldCurrency || soldAt.slice(0, 10) !== input.soldAt.slice(0, 10)) {
    return needs("The stored sale amount or date does not agree with the original eBay check.");
  }

  if (!imageUrls.length) return needs("eBay did not return listing photos for an in-RAR review.");

  if (grade.conflict || (grade.isGraded && (!grade.company || !grade.grade))) {
    return needs("The grading company or exact grade needs a closer look.");
  }
  // A seller's first-print claim is not copyright-page proof. Keep it in the
  // exception queue rather than make a one-tap approval silently file it as
  // an unidentified printing.
  if (/\b(?:(?:first|1st|second|2nd|third|3rd)\s+(?:print|printing|impression|edition)|\d+(?:th|st|nd|rd)\s+print(?:ing)?)\b|(?:第\s*\d+\s*刷|初版)/iu.test(title)) {
    return needs("Printing claim needs a copyright-page photo before approval.");
  }

  return {
    ready: true, reason: null, price, currency, soldAt,
    grading: grade.isGraded ? "graded" : "raw",
    gradingCompany: grade.isGraded ? grade.company : null,
    gradeLabel: grade.isGraded ? grade.grade : null,
    printing: "printing_not_identified",
    imageUrls, itemSpecifics, checkedAt: check.checkedAt,
  };
}
