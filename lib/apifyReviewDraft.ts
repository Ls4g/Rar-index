import { APIFY_SOLD_SEARCH_PROVIDER } from "./salesInbox.ts";

// Hints for a human reading the original eBay page. These values must never
// populate listing_outcomes.sold_* or a price observation on their own.
export type ApifyReviewDraft = {
  amount: string | null;
  currency: string | null;
  endedDate: string | null;
};

const FORM_CURRENCIES = new Set(["GBP", "USD", "EUR", "JPY", "CAD", "AUD"]);

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validEndedDate(value: unknown, today: string): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value <= today
    ? value : null;
}

export function apifyReviewDraft(snapshot: unknown, bestOffer: boolean, today = new Date().toISOString().slice(0, 10)): ApifyReviewDraft | null {
  const source = object(snapshot);
  if (source?.provider !== APIFY_SOLD_SEARCH_PROVIDER) return null;
  const item = object(source.item);
  if (!item) return null;

  const currency = typeof item.soldCurrency === "string" && FORM_CURRENCIES.has(item.soldCurrency.toUpperCase())
    ? item.soldCurrency.toUpperCase() : null;
  const amountNumber = typeof item.soldPrice === "number" || typeof item.soldPrice === "string"
    ? Number(item.soldPrice) : NaN;
  const validPrecision = typeof item.soldPrice === "string"
    ? /^\d+(?:\.\d{1,2})?$/.test(item.soldPrice)
    : Math.abs(Math.round(amountNumber * 100) / 100 - amountNumber) < 1e-8;
  // An accepted Best Offer's search figure can be its old asking price.
  // A price range is not one copy's paid amount either.
  const amount = !bestOffer && item.isBestOfferAccepted !== true && item.soldPriceMax == null
    && currency && validPrecision && Number.isFinite(amountNumber) && amountNumber > 0
    ? String(amountNumber) : null;

  return { amount, currency, endedDate: validEndedDate(item.endedAt, today) };
}
