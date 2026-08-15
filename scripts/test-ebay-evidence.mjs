import assert from "node:assert/strict";
import {
  collectEbayEvidenceImageUrls,
  ebayMarketplaceFromUrl,
  extractEbayLegacyItemId,
} from "../lib/ebayEvidence.ts";

assert.equal(extractEbayLegacyItemId("https://www.ebay.co.uk/itm/Some-Manga/366419349362?foo=bar"), "366419349362");
assert.equal(extractEbayLegacyItemId("https://www.ebay.com/itm/800055394441"), "800055394441");
assert.equal(extractEbayLegacyItemId("800055394441"), "800055394441");
assert.equal(extractEbayLegacyItemId("https://example.com/item/800055394441"), "");
assert.equal(ebayMarketplaceFromUrl("https://www.ebay.co.uk/itm/366419349362"), "EBAY_GB");
assert.equal(ebayMarketplaceFromUrl("https://www.ebay.com/itm/800055394441"), "EBAY_US");
assert.equal(ebayMarketplaceFromUrl("https://example.com/itm/800055394441"), null);
assert.deepEqual(collectEbayEvidenceImageUrls({
  image: { imageUrl: "https://i.ebayimg.com/primary.jpg" },
  additionalImages: [
    { imageUrl: "https://i.ebayimg.com/proof.jpg" },
    { imageUrl: "https://i.ebayimg.com/primary.jpg" },
    { imageUrl: "javascript:alert(1)" },
  ],
  thumbnailImages: [{ imageUrl: "https://i.ebayimg.com/thumb.jpg" }],
}), [
  "https://i.ebayimg.com/primary.jpg",
  "https://i.ebayimg.com/proof.jpg",
  "https://i.ebayimg.com/thumb.jpg",
]);

console.log("eBay evidence helper tests passed.");
