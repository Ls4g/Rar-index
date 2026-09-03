export type DetectedGrading = {
  isGraded: boolean;
  company: string;
  grade: string;
};

export type ParsedSubmittedSale = {
  sourceListingUrl: string;
  listingTitle: string;
  soldDate: string;
  salePrice: string;
  shippingPrice: string;
  currency: string;
  quantity: string;
  saleType: "auction" | "best_offer" | "fixed_price" | "unknown";
  grading: DetectedGrading;
  bestOfferDetected: boolean;
};

const BEST_OFFER = /\b(?:best\s+offer(?:\s+accepted)?|accepted\s+offer|offer\s+accepted)\b/i;
const GRADED = /\b(?:cgc|cbcs|bgs|beckett|psa|graded|slab(?:bed)?)\b/i;
const GRADING_COMPANY = /\b(CGC|CBCS|BGS|BECKETT|PSA)\b/i;

function normaliseCompany(value: string) {
  const upper = value.toUpperCase();
  return upper === "BECKETT" ? "BGS" : upper;
}

export function detectGrading(value: string): DetectedGrading {
  const companyMatch = value.match(GRADING_COMPANY);
  const company = companyMatch ? normaliseCompany(companyMatch[1]) : "";
  const gradePattern = company
    ? new RegExp(`\\b(?:${company === "BGS" ? "BGS|BECKETT" : company})\\s*(?:GRADE\\s*)?(10(?:\\.0)?|[1-9](?:\\.[0-9])?)\\b`, "i")
    : null;
  const labelledGrade = value.match(/\b(?:grade|graded)\s*(10(?:\.0)?|[1-9](?:\.[0-9])?)\b/i)?.[1] ?? "";
  const grade = gradePattern?.exec(value)?.[1] ?? labelledGrade;
  return { isGraded: GRADED.test(value), company, grade };
}

export function detectsBestOffer(value: string) {
  return BEST_OFFER.test(value);
}

function labelledValue(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`^\\s*${label}\\s*[:\\-]\\s*(.+?)\\s*$`, "im"));
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function currencyFromToken(token: string) {
  const upper = token.toUpperCase();
  if (upper.includes("£") || upper.includes("GBP")) return "GBP";
  if (upper.includes("€") || upper.includes("EUR")) return "EUR";
  if (upper.includes("¥") || upper.includes("JPY")) return "JPY";
  if (upper.includes("$") || upper.includes("USD")) return "USD";
  return "";
}

function amountFromToken(token: string) {
  const match = token.replace(/,/g, "").match(/(?:GBP|USD|EUR|JPY|£|\$|€|¥)?\s*([0-9]+(?:\.[0-9]{1,2})?)/i);
  return match?.[1] ?? "";
}

function isoDate(value: string) {
  const exact = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (exact) return exact;
  const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const dayFirst = value.match(/\b(\d{1,2})\s+([a-z]{3,9})\s+(20\d{2})\b/i);
  const monthFirst = dayFirst ? null : value.match(/\b([a-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  const day = Number(dayFirst?.[1] ?? monthFirst?.[2]);
  const monthName = (dayFirst?.[2] ?? monthFirst?.[1] ?? "").slice(0, 3).toLowerCase();
  const year = Number(dayFirst?.[3] ?? monthFirst?.[3]);
  const month = monthNames.indexOf(monthName);
  if (day >= 1 && day <= 31 && month >= 0 && year >= 2000) {
    const date = new Date(Date.UTC(year, month, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day) return date.toISOString().slice(0, 10);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Date(parsed).toISOString().slice(0, 10);
}

export function parseSubmittedSaleText(text: string): ParsedSubmittedSale {
  const title = labelledValue(text, ["listing\\s+title", "title"]);
  const url = labelledValue(text, ["source\\s+url", "listing\\s+url", "url"])
    || text.match(/https?:\/\/[^\s<>]+/i)?.[0]?.replace(/[),.;]+$/, "")
    || "";
  const soldDateText = labelledValue(text, ["sold\\s+date", "date\\s+sold", "sold", "ended"]);
  const salePriceToken = labelledValue(text, ["actual\\s+paid\\s+price", "sold\\s+price", "sale\\s+price", "price"]);
  const shippingToken = labelledValue(text, ["shipping", "postage", "delivery"]);
  const fallbackMoney = text.match(/(?:GBP|USD|EUR|JPY|£|\$|€|¥)\s*[0-9][0-9,.]*/i)?.[0] ?? "";
  const priceToken = salePriceToken || fallbackMoney;
  const quantityMatch = text.match(/\b(\d+)[ \t]+(?:copies[ \t]+)?sold\b/i);
  const bestOfferDetected = detectsBestOffer(text);
  const saleType = bestOfferDetected
    ? "best_offer"
    : /\b(?:auction|bids?)\b/i.test(text)
      ? "auction"
      : /\b(?:buy\s+it\s+now|fixed\s+price)\b/i.test(text)
        ? "fixed_price"
        : "unknown";

  return {
    sourceListingUrl: url,
    listingTitle: title,
    soldDate: isoDate(soldDateText),
    salePrice: amountFromToken(priceToken),
    shippingPrice: amountFromToken(shippingToken),
    currency: currencyFromToken(priceToken || shippingToken),
    quantity: quantityMatch?.[1] ?? "1",
    saleType,
    grading: detectGrading(`${title}\n${text}`),
    bestOfferDetected,
  };
}
