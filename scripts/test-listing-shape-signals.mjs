// node --experimental-strip-types scripts/test-listing-shape-signals.mjs
import assert from "node:assert/strict";
import { listingShapeSignals } from "../lib/listingOutcomeProviders.ts";

const retail = `<GetItemResponse><Item><Quantity>40</Quantity><ConditionDisplayName>Brand New</ConditionDisplayName>
<ProductListingDetails><ProductReferenceID>5056871110</ProductReferenceID><IncludeStockPhotoURL>true</IncludeStockPhotoURL>
<UseStockPhotoURLAsGallery>true</UseStockPhotoURLAsGallery><StockPhotoURL>https://i.ebayimg.com/00/s/stock.jpg</StockPhotoURL></ProductListingDetails>
<PictureDetails><PictureSource>Vendor</PictureSource><PictureURL>https://i.ebayimg.com/a.jpg</PictureURL></PictureDetails><QuantitySold>3</QuantitySold></Item></GetItemResponse>`;
const collector = `<GetItemResponse><Item><Quantity>1</Quantity><ConditionDisplayName>Very Good</ConditionDisplayName>
<PictureDetails><PictureSource>EPS</PictureSource><PictureURL>https://i.ebayimg.com/1.jpg</PictureURL><PictureURL>https://i.ebayimg.com/2.jpg</PictureURL></PictureDetails></Item></GetItemResponse>`;

const r = listingShapeSignals(retail);
assert.equal(r.productReferenceId, "5056871110");
assert.equal(r.includeStockPhotoUrl, "true");
assert.equal(r.quantity, 40);
assert.equal(r.photoCount, 1);
assert.equal(r.condition, "Brand New");
const c = listingShapeSignals(collector);
assert.equal(c.productReferenceId, null);
assert.equal(c.stockPhotoUrl, null);
assert.equal(c.photoCount, 2);
assert.equal(c.quantity, 1);
console.log("listing shape signals: ok");
