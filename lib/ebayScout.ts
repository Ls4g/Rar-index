type EBayItem = {
  itemId?: string;
  itemWebUrl?: string;
  title?: string;
  price?: { value?: string; currency?: string };
  condition?: string;
  itemEndDate?: string;
};

type EBaySearchResponse = { itemSummaries?: EBayItem[] };

async function applicationToken() {
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

export async function findActiveEbayListings(query: string) {
  const token = await applicationToken();
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
      rawPayload: item,
    }];
  });
}
