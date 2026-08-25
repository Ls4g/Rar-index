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
//   -- requires an auth'n'auth USER token. It is a different credential, not a
//   different scope, and no user-token variable exists anywhere in this
//   codebase (only EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_MARKETPLACE_ID and
//   EBAY_DELETION_VERIFICATION_TOKEN are referenced). So Trading is
//   unavailable today, and adding a scope will not change that.
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
// The honest consequence: until a sold-capable provider is authorised, this
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
};

const MARKETPLACE_INSIGHTS_SCOPE = "https://api.ebay.com/oauth/api_scope/buy.marketplace.insights";

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
export async function probeOutcomeProviders(): Promise<ProviderCapability[]> {
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

  capabilities.push({
    provider: "eBay Trading (GetItem)",
    available: Boolean(process.env.EBAY_USER_TOKEN?.trim()),
    canConfirmSales: Boolean(process.env.EBAY_USER_TOKEN?.trim()),
    detail: process.env.EBAY_USER_TOKEN?.trim()
      ? "A user token is configured. GetItem can read ended third-party listings."
      : "No user token configured. Trading API needs an auth'n'auth user token, which is a different credential from the client-credentials application token RAR uses -- adding a scope will not enable it.",
  });

  return capabilities;
}

// The provider actually used for a check: the best one available, preferring
// anything that can confirm a sale.
export async function resolveListingOutcome(itemId: string, marketplace: string | null, listingTitle: string): Promise<OutcomeProviderResult> {
  const insights = await marketplaceInsightsOutcomeProvider(itemId, marketplace, listingTitle);
  if (insights.signal.listingState === "completed_sold") return insights;

  const browse = await browseOutcomeProvider(itemId, marketplace);
  // Browse saying "still active" is a real answer and outranks Insights
  // finding nothing.
  if (browse.signal.listingState === "active") return browse;
  // Insights authorised and silent on this id is more informative than Browse
  // simply not carrying ended listings, but neither proves anything, so the
  // more explicit detail wins for the audit trail.
  if (insights.httpStatus === 200) return insights;
  return browse;
}
