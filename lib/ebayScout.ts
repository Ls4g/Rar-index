type EBayItem = {
  itemId?: string;
  itemWebUrl?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  condition?: string;
  itemEndDate?: string;
  // Already present in every stored lead payload, just never surfaced. A
  // photograph of a real copy is the only way to *see* a magazine issue:
  // its cover art is copyrighted, so no catalogue source carries a picture.
  image?: { imageUrl?: string };
  thumbnailImages?: Array<{ imageUrl?: string }>;
  estimatedAvailabilities?: Array<{ estimatedAvailabilityStatus?: string }>;
  buyingOptions?: string[];
};

type EBaySearchResponse = { itemSummaries?: EBayItem[] };

export type ActiveEbayListing = {
  externalId: string;
  url: string;
  title: string;
  price: number | null;
  currency: string | null;
  condition: string | null;
  itemEndAt: string | null;
  imageUrl: string | null;
  rawPayload: EBayItem;
};

export type EbayAvailabilityCheck = {
  outcome: "active" | "unavailable" | "inconclusive";
  itemEndAt: string | null;
  reason: string;
};

type EbayErrorPayload = { errors?: Array<{ errorId?: number; message?: string; longMessage?: string }> };

export function interpretEbayAvailabilityResponse(
  status: number,
  payload: EBayItem | EbayErrorPayload | null,
  now = Date.now(),
): EbayAvailabilityCheck {
  if (status === 200) {
    const item = (payload ?? {}) as EBayItem;
    const itemEndAt = item.itemEndDate ?? null;
    if (itemEndAt && new Date(itemEndAt).getTime() <= now) {
      return { outcome: "unavailable", itemEndAt, reason: `eBay reports that the listing ended on ${itemEndAt}.` };
    }
    const availability = item.estimatedAvailabilities?.[0]?.estimatedAvailabilityStatus?.toUpperCase();
    if (availability === "OUT_OF_STOCK") {
      return { outcome: "unavailable", itemEndAt, reason: "eBay reports that the listing is out of stock." };
    }
    return { outcome: "active", itemEndAt, reason: "eBay confirms that the listing remains available." };
  }

  if (status === 404) {
    return { outcome: "unavailable", itemEndAt: null, reason: "The previously valid eBay item ID is no longer available from the Browse item endpoint." };
  }

  const errors = (payload as EbayErrorPayload | null)?.errors ?? [];
  const detail = errors[0]?.longMessage ?? errors[0]?.message;
  return {
    outcome: "inconclusive",
    itemEndAt: null,
    reason: detail ? `eBay availability check was inconclusive: ${detail}` : `eBay availability check returned HTTP ${status}; the lead was left untouched.`,
  };
}

export async function checkEbayListingAvailability(
  itemId: string,
  marketplaceId: string,
  applicationToken?: string,
): Promise<EbayAvailabilityCheck> {
  const token = applicationToken ?? await getEbayApplicationToken();
  const url = new URL(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`);
  url.searchParams.set("fieldgroups", "COMPACT");
  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
      },
      cache: "no-store",
    });
    let payload: EBayItem | EbayErrorPayload | null = null;
    try {
      payload = await response.json() as EBayItem | EbayErrorPayload;
    } catch {
      // An empty or non-JSON response is inconclusive unless the HTTP status
      // itself is the authoritative 404 used for ended/unavailable items.
    }
    return interpretEbayAvailabilityResponse(response.status, payload);
  } catch {
    return { outcome: "inconclusive", itemEndAt: null, reason: "The eBay availability request failed; the lead was left untouched." };
  }
}

export async function getEbayApplicationToken() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("eBay Scout is not configured. Add EBAY_CLIENT_ID and EBAY_CLIENT_SECRET in Vercel first.");

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("eBay did not issue an application token. Check the Scout credentials in Vercel.");
  const payload = await response.json() as { access_token?: string };
  if (!payload.access_token) throw new Error("eBay returned no application token.");
  return payload.access_token;
}

export async function findActiveEbayListings(query: string, applicationToken?: string): Promise<ActiveEbayListing[]> {
  const token = applicationToken ?? await getEbayApplicationToken();
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "50");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("eBay active-listing search failed. Check the configured marketplace and API access.");
  const payload = await response.json() as EBaySearchResponse;
  return (payload.itemSummaries ?? []).flatMap((item) => {
    if (!item.itemId || !item.itemWebUrl || !item.title) return [];
    return [{
      externalId: item.itemId,
      url: item.itemWebUrl,
      title: item.title,
      price: item.price?.value ? Number(item.price.value) : null,
      currency: item.price?.currency ?? null,
      condition: item.condition ?? null,
      itemEndAt: item.itemEndDate ?? null,
      imageUrl: item.image?.imageUrl ?? item.thumbnailImages?.[0]?.imageUrl ?? null,
      rawPayload: item,
    }];
  });
}
