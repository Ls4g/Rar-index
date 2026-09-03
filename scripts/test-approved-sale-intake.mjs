import assert from "node:assert/strict";
import fs from "node:fs";
import { detectGrading, detectsBestOffer, parseSubmittedSaleText } from "../lib/submittedSale.ts";

const bgs = detectGrading("Hunter x Hunter Vol. 1 Japanese Manga BGS 9.0");
assert.deepEqual(bgs, { isGraded: true, company: "BGS", grade: "9.0" });

const beckett = detectGrading("Beckett 8.5 graded manga");
assert.deepEqual(beckett, { isGraded: true, company: "BGS", grade: "8.5" });

const raw = detectGrading("One Piece Vol. 1 Japanese manga first printing");
assert.equal(raw.isGraded, false);
assert.equal(raw.company, "");
assert.equal(raw.grade, "");

assert.equal(detectsBestOffer("Best Offer accepted"), true);
assert.equal(detectsBestOffer("Buy It Now"), false);

const parsed = parseSubmittedSaleText(`
Title: Hunter × Hunter Vol. 1 Japanese Manga BGS 9.0
Sold price: £166.84
Sold date: 30 Aug 2026
Postage: £5.66
Sale type: Best Offer accepted
5 sold
URL: https://www.ebay.co.uk/itm/123456789012
`);
assert.equal(parsed.listingTitle, "Hunter × Hunter Vol. 1 Japanese Manga BGS 9.0");
assert.equal(parsed.salePrice, "166.84");
assert.equal(parsed.shippingPrice, "5.66");
assert.equal(parsed.currency, "GBP");
assert.equal(parsed.soldDate, "2026-08-30");
assert.equal(parsed.quantity, "5");
assert.equal(parsed.saleType, "best_offer");
assert.deepEqual(parsed.grading, { isGraded: true, company: "BGS", grade: "9.0" });
assert.equal(parsed.sourceListingUrl, "https://www.ebay.co.uk/itm/123456789012");

const migration = fs.readFileSync(new URL("../supabase/migrations/20260904_approved_sale_intake.sql", import.meta.url), "utf8");
assert.match(migration, /create or replace function public\.approve_submitted_sale/);
assert.match(migration, /insert into public\.price_observations/);
assert.match(migration, /insert into public\.price_review_decisions/);
assert.match(migration, /insert into public\.price_print_classification_decisions/);
assert.match(migration, /insert into public\.sale_intake_decisions/);
assert.match(migration, /best_offer.*corroboration/is);
assert.match(migration, /Item price excludes delivery/);

const route = fs.readFileSync(new URL("../app/api/add-sale/route.ts", import.meta.url), "utf8");
assert.doesNotMatch(route, /getEbayListingEvidence/);
assert.match(route, /admin\.rpc\("approve_submitted_sale"/);
assert.match(route, /humanConfirmed/);

console.log("Approved sale intake: 22 checks passed.");
