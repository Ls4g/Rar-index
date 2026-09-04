// Where an outcome signal comes from. Deliberately an adapter boundary: which
// eBay API RAR is allowed to call is an access question that may change, and
// the classification rules must not have to change with it.
//
// WHAT RAR CAN ACTUALLY CALL TODAY, established rather than assumed:
//
//   lib/ebayScout.ts obtains a token with grant_type=client_credentials and
//   scope https://api.ebay.com/oauth/api_scope. That is an APPLICATION token.
//
//   Trading API GetItem -- the usual way to read an ended third-party listing
//   -- requires a USER token. RAR supports the legacy Auth'n'Auth token eBay's
//   production token generator issues (EBAY_AUTH_N_AUTH_TOKEN), or OAuth via
//   EBAY_USER_TOKEN / the preferable long-lived EBAY_USER_REFRESH_TOKEN.
//
//   Browse API works with the application token but only serves ACTIVE
//   listings. It can prove "still live" and "no longer retrievable" and
//   nothing else -- and "no longer retrievable" is not a sale.
//
//   Marketplace Insights API returns genuine sold records for the last 90 days
//   and does use an application token, but it is a LIMITED RELEASE that eBay
//   must approve per application. Whether RAR's keys carry it is unknown until
//   asked, which is what probeOutcomeProviders below is for.
//
// The honest consequence: until either Trading or Marketplace Insights is
// authorised, this
// pipeline observes, schedules, checks and records -- and correctly refuses to
// produce a single sold candidate. That is the rules working, not a bug.
import { getEbayApplicationToken, hasEbayApplicationCredentials } from "./ebayScout.ts";
import type { OutcomeSignal } from "./listingOutcome.ts";

export type ProviderCapability = {
  provider: string;
  available: boolean;
  canConfirmSales: boolean;
  detail: string;
};

export type OutcomeProviderResult = {
  signal: OutcomeSignal;
  httpStatus: number | null;
  rawResponse: unknown;
  attempts?: ProviderAttempt[];
};

export type SubmittedEbaySaleEvidence = {
  itemId: string;
  state: OutcomeSignal["listingState"];
  title: string;
  imageUrls: string[];
  soldPrice: number | null;
  soldCurrency: string | null;
  soldAt: string | null;
  shippingPrice: number | null;
  quantitySold: number | null;
  buyingFormat: string | null;
  bestOffer: boolean;
  detail: string;
};

export type ProviderAttempt = {
  provider: string;
  listingState: OutcomeSignal["listingState"];
  httpStatus: number | null;
  detail: string;
};

export type OutcomeProbeSample = {
  itemId: string;
  marketplace: string | null;
};

function providerAttempt(result: OutcomeProviderResult): ProviderAttempt {
  return {
    provider: result.signal.provider,
    listingState: result.signal.listingState,
    httpStatus: result.httpStatus,
    detail: result.signal.detail,
  };
}

function withAttempts(result: OutcomeProviderResult, attempts: ProviderAttempt[]): OutcomeProviderResult {
  return { ...result, attempts };
}

const MARKETPLACE_INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

let cachedUserAccessToken: { value: string; expiresAt: number } | null = null;
let cachedTradingCapability: { key: string; value: ProviderCapability; expiresAt: number } | null = null;

export function hasEbayUserCredentials() {
  return Boolean(
    process.env.EBAY_AUTH_N_AUTH_TOKEN?.trim()
    || process.env.EBAY_USER_TOKEN?.trim()
    || process.env.EBAY_USER_REFRESH_TOKEN?.trim(),
  );
}

async function getEbayUserAccessToken() {
  const directToken = process.env.EBAY_USER_TOKEN?.trim();
  if (directToken) return directToken;
  if (cachedUserAccessToken && cachedUserAccessToken.expiresAt > Date.now() + 60_000) return cachedUserAccessToken.value;

  const refreshToken = process.env.EBAY_USER_REFRESH_TOKEN?.trim();
  const clientId = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error("eBay user access is not configured. Add EBAY_USER_REFRESH_TOKEN after authorising the RAR eBay account.");
  }

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`eBay refused the RAR account refresh token (HTTP ${response.status}). Re-authorise the account rather than replacing the production client ID.`);
  }
  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("eBay returned no user access token.");
  cachedUserAccessToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 7200) * 1000,
  };
  return payload.access_token;
}

function xmlText(xml: string, tag: string) {
  const lowerXml = xml.toLowerCase();
  const exactOpen = `<${tag.toLowerCase()}>`;
  const exactClose = `</${tag.toLowerCase()}>`;
  const exactStart = lowerXml.indexOf(exactOpen);
  if (exactStart >= 0) {
    const valueStart = exactStart + exactOpen.length;
    const valueEnd = lowerXml.indexOf(exactClose, valueStart);
    if (valueEnd >= 0) return xml.slice(valueStart, valueEnd).trim();
  }
  const match = xml.match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "i"));
  return match?.[1]?.trim() ?? null;
}

function xmlAmount(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!match) return { value: null, currency: null };
  const currency = match[1].match(/currencyID=["']([^"']+)["']/i)?.[1] ?? null;
  const parsed = Number(match[2].trim());
  return { value: Number.isFinite(parsed) ? parsed : null, currency };
}

function xmlTexts(xml: string, tag: string) {
  return [...xml.matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "gi"))]
    .map((match) => decodeXmlText(match[1]?.trim() ?? ""))
    .filter(Boolean);
}

function decodeXmlText(value: string) {
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function tradingSiteId(marketplace: string | null) {
  const sites: Record<string, string> = {
    EBAY_US: "0", EBAY_CA: "2", EBAY_GB: "3", EBAY_AU: "15", EBAY_AT: "16",
    EBAY_DE: "77", EBAY_FR: "71", EBAY_IT: "101", EBAY_NL: "146", EBAY_ES: "186",
  };
  return sites[marketplaceHeader(marketplace)] ?? "0";
}

function marketplaceHeader(marketplace: string | null) {
  return marketplace?.trim() || process.env.EBAY_MARKETPLACE_ID || "EBAY_GB";
}

// ---------------------------------------------------------------- browse ----
// Available today. Can never confirm a sale, by construction.
export async function browseOutcomeProvider(itemId: string, marketplace: string | null): Promise<OutcomeProviderResult> {
  const provider = "eBay Browse";
  const base: OutcomeSignal = {
    provider, listingState: "unknown", soldPrice: null, soldCurrency: null, soldAt: null,
    bidCount: null, buyingFormat: null, bestOfferAccepted: null, scheduledEndAt: null,
    httpStatus: null, detail: "",
  };
  if (!hasEbayApplicationCredentials()) {
    return { signal: { ...base, detail: "eBay application credentials are not configured." }, httpStatus: null, rawResponse: null };
  }

  let token: string;
  try {
    token = await getEbayApplicationToken();
  } catch (error) {
    return {
      signal: { ...base, detail: `eBay did not issue a token: ${error instanceof Error ? error.message : "unknown error"}` },
      httpStatus: null,
      rawResponse: null,
    };
  }

  const url = new URL("https://api.ebay.com/buy/browse/v1/item/get_item_by_legacy_id");
  url.searchParams.set("legacy_item_id", itemId);
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceHeader(marketplace) },
      cache: "no-store",
    });
  } catch (error) {
    return {
      signal: { ...base, detail: `Network error contacting eBay: ${error instanceof Error ? error.message : "unknown"}` },
      httpStatus: null,
      rawResponse: null,
    };
  }

  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* non-JSON body */ }

  if (response.status === 200) {
    const item = payload as { itemEndDate?: string; buyingOptions?: string[]; bidCount?: number } | null;
    return {
      signal: {
        ...base,
        listingState: "active",
        buyingFormat: item?.buyingOptions?.join(",") ?? null,
        bidCount: typeof item?.bidCount === "number" ? item.bidCount : null,
        scheduledEndAt: item?.itemEndDate ?? null,
        httpStatus: 200,
        detail: "Browse still serves this listing, so it has not ended.",
      },
      httpStatus: 200,
      rawResponse: payload,
    };
  }

  if (response.status === 404) {
    return {
      signal: {
        ...base,
        listingState: "not_found",
        httpStatus: 404,
        // Said plainly so nobody later mistakes this for an unsold result.
        detail: "Browse no longer serves this listing. Browse only carries active listings, so this means it ended -- not that it sold or that it did not.",
      },
      httpStatus: 404,
      rawResponse: payload,
    };
  }

  return {
    signal: { ...base, httpStatus: response.status, detail: `eBay Browse returned HTTP ${response.status}. The outcome is unknown and will be retried.` },
    httpStatus: response.status,
    rawResponse: payload,
  };
}

// ------------------------------------------------------------- trading ----
// GetItem can read a watched third-party listing after it ends, but only with
// a USER token issued after the RAR eBay account grants consent. This is the
// missing link between watching an active listing and obtaining a real outcome.
export async function tradingOutcomeProvider(itemId: string, marketplace: string | null): Promise<OutcomeProviderResult> {
  const provider = "eBay Trading GetItem";
  const base: OutcomeSignal = {
    provider, listingState: "unknown", soldPrice: null, soldCurrency: null, soldAt: null,
    bidCount: null, buyingFormat: null, bestOfferAccepted: null, scheduledEndAt: null,
    httpStatus: null, detail: "",
  };
  if (!hasEbayUserCredentials()) {
    return { signal: { ...base, detail: "eBay user access is not configured. Add EBAY_AUTH_N_AUTH_TOKEN or an OAuth refresh token after authorising the RAR eBay account." }, httpStatus: null, rawResponse: null };
  }

  const authNAuthToken = process.env.EBAY_AUTH_N_AUTH_TOKEN?.trim() || null;
  let oauthToken: string | null = null;
  if (!authNAuthToken) {
    try {
      oauthToken = await getEbayUserAccessToken();
    } catch (error) {
      return { signal: { ...base, detail: error instanceof Error ? error.message : "eBay user token request failed." }, httpStatus: null, rawResponse: null };
    }
  }

  const credentialsXml = authNAuthToken
    ? `<RequesterCredentials><eBayAuthToken>${escapeXml(authNAuthToken)}</eBayAuthToken></RequesterCredentials>`
    : "";
  const requestXml = `<?xml version="1.0" encoding="utf-8"?><GetItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">${credentialsXml}<DetailLevel>ReturnAll</DetailLevel><ItemID>${itemId.replace(/[^0-9]/g, "")}</ItemID></GetItemRequest>`;
  let response: Response;
  try {
    response = await fetch("https://api.ebay.com/ws/api.dll", {
      method: "POST",
      headers: {
        "Content-Type": "text/xml",
        "X-EBAY-API-CALL-NAME": "GetItem",
        "X-EBAY-API-COMPATIBILITY-LEVEL": "1423",
        "X-EBAY-API-SITEID": tradingSiteId(marketplace),
        ...(oauthToken ? { "X-EBAY-API-IAF-TOKEN": oauthToken } : {}),
      },
      body: requestXml,
      cache: "no-store",
    });
  } catch (error) {
    return { signal: { ...base, detail: `Network error contacting eBay Trading: ${error instanceof Error ? error.message : "unknown"}` }, httpStatus: null, rawResponse: null };
  }

  const xml = await response.text();
  const ack = xmlText(xml, "Ack");
  if (!response.ok || (ack !== "Success" && ack !== "Warning")) {
    const errorCode = xmlText(xml, "ErrorCode");
    const errorMessage = xmlText(xml, "LongMessage") ?? xmlText(xml, "ShortMessage") ?? "eBay Trading rejected the request.";
    return {
      signal: {
        ...base,
        listingState: errorCode === "17" ? "not_found" : "unknown",
        httpStatus: response.status,
        detail: `eBay Trading returned ${errorCode ? `error ${errorCode}: ` : ""}${errorMessage}`,
      },
      httpStatus: response.status,
      rawResponse: { ack, errorCode, errorMessage },
    };
  }

  const listingStatus = (xmlText(xml, "ListingStatus") ?? "").toLowerCase();
  const quantitySoldText = xmlText(xml, "QuantitySold");
  const quantitySold = quantitySoldText === null ? null : Number(quantitySoldText);
  const price = xmlAmount(xml, "CurrentPrice");
  const endTime = xmlText(xml, "EndTime");
  const listingType = xmlText(xml, "ListingType");
  const bidCountText = xmlText(xml, "BidCount");
  const bidCount = bidCountText === null ? null : Number(bidCountText);
  const bestOfferEnabled = xmlText(xml, "BestOfferEnabled") === "true";
  const buyingFormat = [listingType, bestOfferEnabled ? "BEST_OFFER" : null].filter(Boolean).join(",") || null;
  const title = decodeXmlText(xmlText(xml, "Title") ?? "");
  const imageUrls = [...new Set([
    ...xmlTexts(xml, "PictureURL"),
    ...xmlTexts(xml, "GalleryURL"),
  ])];
  const shipping = xmlAmount(xml, "ShippingServiceCost");
  const sharedRaw = {
    ack, listingStatus, quantitySold, price, endTime, listingType, bidCount,
    bestOfferEnabled, title, imageUrls, shipping,
  };

  if (listingStatus === "active") {
    return { signal: { ...base, listingState: "active", buyingFormat, bidCount, scheduledEndAt: endTime, httpStatus: response.status, detail: "Trading GetItem reports that this listing is still active." }, httpStatus: response.status, rawResponse: sharedRaw };
  }
  if (["completed", "ended"].includes(listingStatus) && quantitySold !== null && quantitySold > 0) {
    return {
      signal: {
        ...base, listingState: "completed_sold", soldPrice: price.value, soldCurrency: price.currency,
        soldAt: endTime, bidCount: Number.isFinite(bidCount) ? bidCount : null, buyingFormat,
        bestOfferAccepted: bestOfferEnabled ? null : false, scheduledEndAt: endTime,
        httpStatus: response.status,
        detail: bestOfferEnabled
          ? "Trading GetItem reports that the listing sold, but Best Offer was enabled so the accepted amount is not public."
          : "Trading GetItem reports that at least one item sold and returned the final public price.",
      },
      httpStatus: response.status,
      rawResponse: sharedRaw,
    };
  }
  if (["completed", "ended"].includes(listingStatus) && quantitySold === 0) {
    return { signal: { ...base, listingState: "completed_unsold", bidCount: Number.isFinite(bidCount) ? bidCount : null, buyingFormat, scheduledEndAt: endTime, httpStatus: response.status, detail: "Trading GetItem reports that the listing ended with zero items sold." }, httpStatus: response.status, rawResponse: sharedRaw };
  }

  return { signal: { ...base, httpStatus: response.status, detail: `Trading GetItem returned listing status ${listingStatus || "unknown"} without a conclusive sold quantity.` }, httpStatus: response.status, rawResponse: { ack, listingStatus, quantitySold, endTime } };
}

/**
 * One deliberate staff lookup for a pasted eBay URL. This is intentionally
 * separate from Scout's bulk collection path: it saves a human from retyping
 * public listing facts without spending one API request per background lead.
 */
export async function getSubmittedEbaySaleEvidence(
  itemId: string,
  marketplace: string | null,
): Promise<SubmittedEbaySaleEvidence> {
  const result = await tradingOutcomeProvider(itemId, marketplace);
  const raw = (result.rawResponse ?? {}) as {
    title?: string;
    imageUrls?: string[];
    quantitySold?: number | null;
    shipping?: { value?: number | null; currency?: string | null };
  };
  const bestOffer = (result.signal.buyingFormat ?? "").toUpperCase().includes("BEST_OFFER");
  return {
    itemId,
    state: result.signal.listingState,
    title: raw.title?.trim() ?? "",
    imageUrls: Array.isArray(raw.imageUrls) ? raw.imageUrls.filter(Boolean) : [],
    // eBay's public CurrentPrice is not necessarily the accepted Best Offer.
    soldPrice: bestOffer ? null : result.signal.soldPrice,
    soldCurrency: result.signal.soldCurrency,
    soldAt: result.signal.soldAt,
    shippingPrice: typeof raw.shipping?.value === "number" ? raw.shipping.value : null,
    quantitySold: typeof raw.quantitySold === "number" && Number.isFinite(raw.quantitySold) ? raw.quantitySold : null,
    buyingFormat: result.signal.buyingFormat,
    bestOffer,
    detail: result.signal.detail,
  };
}

// ------------------------------------------------- marketplace insights ----
// Genuine sold data, if eBay has approved this application for it.
export async function marketplaceInsightsOutcomeProvider(
  itemId: string,
  marketplace: string | null,
  listingTitle: string,
): Promise<OutcomeProviderResult> {
  const provider = "eBay Marketplace Insights";
  const base: OutcomeSignal = {
    provider, listingState: "unknown", soldPrice: null, soldCurrency: null, soldAt: null,
    bidCount: null, buyingFormat: null, bestOfferAccepted: null, scheduledEndAt: null,
    httpStatus: null, detail: "",
  };

  let token: string;
  try {
    token = await getEbayApplicationToken(MARKETPLACE_INSIGHTS_SCOPE);
  } catch (error) {
    return {
      signal: { ...base, detail: `Marketplace Insights token refused: ${error instanceof Error ? error.message : "unknown"}. This API is a limited release and must be granted by eBay.` },
      httpStatus: null,
      rawResponse: null,
    };
  }

  const url = new URL("https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search");
  url.searchParams.set("q", listingTitle.slice(0, 100));
  url.searchParams.set("limit", "50");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceHeader(marketplace) },
      cache: "no-store",
    });
  } catch (error) {
    return { signal: { ...base, detail: `Network error: ${error instanceof Error ? error.message : "unknown"}` }, httpStatus: null, rawResponse: null };
  }

  let payload: unknown = null;
  try { payload = await response.json(); } catch { /* non-JSON */ }

  if (response.status === 403 || response.status === 401) {
    return {
      signal: { ...base, httpStatus: response.status, detail: "RAR's eBay application is not authorised for Marketplace Insights. It is a limited release that must be applied for." },
      httpStatus: response.status,
      rawResponse: payload,
    };
  }
  if (response.status !== 200) {
    return { signal: { ...base, httpStatus: response.status, detail: `Marketplace Insights returned HTTP ${response.status}.` }, httpStatus: response.status, rawResponse: payload };
  }

  // Only a record for THIS listing counts. A search that returns fifty similar
  // sold items says nothing about the one being watched.
  const sales = (payload as { itemSales?: Array<Record<string, unknown>> } | null)?.itemSales ?? [];
  const match = sales.find((sale) => {
    const legacy = String(sale.legacyItemId ?? "");
    const itemIdValue = String(sale.itemId ?? "");
    return legacy === itemId || itemIdValue.includes(itemId);
  });
  if (!match) {
    return {
      signal: { ...base, httpStatus: 200, detail: "Marketplace Insights returned no sold record for this exact listing id." },
      httpStatus: 200,
      rawResponse: payload,
    };
  }

  const price = match.lastSoldPrice as { value?: string; currency?: string } | undefined;
  return {
    signal: {
      ...base,
      listingState: "completed_sold",
      soldPrice: price?.value ? Number(price.value) : null,
      soldCurrency: price?.currency ?? null,
      soldAt: (match.lastSoldDate as string | undefined) ?? null,
      buyingFormat: Array.isArray(match.buyingOptions) ? (match.buyingOptions as string[]).join(",") : null,
      httpStatus: 200,
      detail: "Marketplace Insights returned a completed sale for this listing id.",
    },
    httpStatus: 200,
    rawResponse: match,
  };
}

// ------------------------------------------------------------ capability ----
// Asks eBay what RAR is allowed to do, rather than assuming. Surfaced on the
// agent dashboard so a degraded integration is visible instead of silently
// producing nothing.
export function tradingCapabilityFromResult(result: OutcomeProviderResult): ProviderCapability {
  const readable = ["active", "completed_sold", "completed_unsold"].includes(result.signal.listingState);
  const reachedTrading = result.httpStatus !== null;
  return {
    provider: "eBay Trading (GetItem)",
    available: reachedTrading,
    // Configuring a token is not proof that GetItem can read the listings RAR
    // watches. Only a live readable sample earns the sold-capable status.
    canConfirmSales: readable,
    detail: readable
      ? `Live test passed (${result.signal.listingState}). GetItem can read watched third-party listings; Best Offer prices remain unconfirmed.`
      : reachedTrading
        ? `Credentials reached eBay, but the live sample was not readable: ${result.signal.detail}`
        : `The live test could not reach GetItem: ${result.signal.detail}`,
  };
}

export async function probeOutcomeProviders(sample?: OutcomeProbeSample): Promise<ProviderCapability[]> {
  const capabilities: ProviderCapability[] = [];

  if (!hasEbayApplicationCredentials()) {
    return [{ provider: "eBay", available: false, canConfirmSales: false, detail: "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not configured in this environment." }];
  }

  try {
    await getEbayApplicationToken();
    capabilities.push({
      provider: "eBay Browse",
      available: true,
      canConfirmSales: false,
      detail: "Available. Serves active listings only, so it can prove a listing is still live or no longer retrievable -- never that it sold.",
    });
  } catch (error) {
    capabilities.push({ provider: "eBay Browse", available: false, canConfirmSales: false, detail: error instanceof Error ? error.message : "Token request failed." });
  }

  try {
    await getEbayApplicationToken(MARKETPLACE_INSIGHTS_SCOPE);
    const url = new URL("https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search");
    url.searchParams.set("q", "manga");
    url.searchParams.set("limit", "1");
    const token = await getEbayApplicationToken(MARKETPLACE_INSIGHTS_SCOPE);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceHeader(null) },
      cache: "no-store",
    });
    capabilities.push({
      provider: "eBay Marketplace Insights",
      available: response.status === 200,
      canConfirmSales: response.status === 200,
      detail: response.status === 200
        ? "Authorised. Returns genuine completed sales for the last 90 days -- this is the only signal that may create a sold candidate."
        : `Not authorised (HTTP ${response.status}). Marketplace Insights is a limited-release API and must be granted by eBay for this application.`,
    });
  } catch (error) {
    capabilities.push({
      provider: "eBay Marketplace Insights",
      available: false,
      canConfirmSales: false,
      detail: `Not authorised: ${error instanceof Error ? error.message : "token refused"}. This API is a limited release.`,
    });
  }

  if (!hasEbayUserCredentials()) {
    capabilities.push({
      provider: "eBay Trading (GetItem)",
      available: false,
      canConfirmSales: false,
      detail: "The RAR eBay account has not authorised this app yet. Add EBAY_AUTH_N_AUTH_TOKEN or an OAuth refresh token after consent; the existing client-credentials token cannot read ended listings.",
    });
  } else if (!sample) {
    capabilities.push({
      provider: "eBay Trading (GetItem)",
      available: true,
      canConfirmSales: false,
      detail: "Credentials are configured, but no watched listing was available for a live read test. Sale confirmation is not claimed until one succeeds.",
    });
  } else {
    const cacheKey = `${sample.marketplace ?? "default"}:${sample.itemId}`;
    if (cachedTradingCapability && cachedTradingCapability.key === cacheKey && cachedTradingCapability.expiresAt > Date.now()) {
      capabilities.push(cachedTradingCapability.value);
    } else {
      const capability = tradingCapabilityFromResult(await tradingOutcomeProvider(sample.itemId, sample.marketplace));
      cachedTradingCapability = { key: cacheKey, value: capability, expiresAt: Date.now() + 10 * 60_000 };
      capabilities.push(capability);
    }
  }

  return capabilities;
}

// The provider actually used for a check: the best one available, preferring
// anything that can confirm a sale.
export async function resolveListingOutcome(itemId: string, marketplace: string | null, listingTitle: string): Promise<OutcomeProviderResult> {
  const attempts: ProviderAttempt[] = [];
  if (hasEbayUserCredentials()) {
    const trading = await tradingOutcomeProvider(itemId, marketplace);
    attempts.push(providerAttempt(trading));
    if (["active", "completed_sold", "completed_unsold"].includes(trading.signal.listingState)) return withAttempts(trading, attempts);
  }
  const insights = await marketplaceInsightsOutcomeProvider(itemId, marketplace, listingTitle);
  attempts.push(providerAttempt(insights));
  if (insights.signal.listingState === "completed_sold") return withAttempts(insights, attempts);

  const browse = await browseOutcomeProvider(itemId, marketplace);
  attempts.push(providerAttempt(browse));
  // Browse saying "still active" is a real answer and outranks Insights
  // finding nothing.
  if (browse.signal.listingState === "active") return withAttempts(browse, attempts);
  // Insights authorised and silent on this id is more informative than Browse
  // simply not carrying ended listings, but neither proves anything, so the
  // more explicit detail wins for the audit trail.
  if (insights.httpStatus === 200) return withAttempts(insights, attempts);
  return withAttempts(browse, attempts);
}
