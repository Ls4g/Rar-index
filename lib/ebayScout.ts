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
