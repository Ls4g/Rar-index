type EbayImageContainer = { imageUrl?: string | null };

export type EbayEvidenceItem = {
  image?: EbayImageContainer | null;
  additionalImages?: EbayImageContainer[] | null;
  thumbnailImages?: EbayImageContainer[] | null;
};

export function extractEbayLegacyItemId(value: string) {
  const trimmed = value.trim();
  if (/^\d{9,}$/.test(trimmed)) return trimmed;
  return trimmed.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,})/i)?.[1] ?? "";
}

export function ebayMarketplaceFromUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, "");
    const marketplaces: Array<[string, string]> = [
      ["ebay.co.uk", "EBAY_GB"],
      ["ebay.com.au", "EBAY_AU"],
      ["ebay.ca", "EBAY_CA"],
      ["ebay.de", "EBAY_DE"],
      ["ebay.fr", "EBAY_FR"],
      ["ebay.it", "EBAY_IT"],
      ["ebay.es", "EBAY_ES"],
      ["ebay.nl", "EBAY_NL"],
      ["ebay.com", "EBAY_US"],
    ];
    return marketplaces.find(([domain]) => hostname === domain || hostname.endsWith(`.${domain}`))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function collectEbayEvidenceImageUrls(item: EbayEvidenceItem) {
  const candidates = [item.image, ...(item.additionalImages ?? []), ...(item.thumbnailImages ?? [])];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const imageUrl = candidate?.imageUrl?.trim() ?? "";
    if (!imageUrl || seen.has(imageUrl)) return [];
    try {
      const parsed = new URL(imageUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
    } catch {
      return [];
    }
    seen.add(imageUrl);
    return [imageUrl];
  });
}
