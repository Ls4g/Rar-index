import assert from "node:assert/strict";
import { matchesBuyMangaFilters, sortBuyMangaItems } from "../lib/buyMangaSearch.ts";

const filters = { query: "One Piece vol 1", language: "English", currency: "USD", maxPrice: 80, sort: "recent" };
const item = (title, volume, price, overrides = {}) => ({
  lead: { listing_title: title, listing_price: price, currency: "USD", last_seen_at: "2026-10-08T12:00:00Z", ...overrides },
  edition: { series: "One Piece", title: "One Piece", volume_number: volume, language: "English" },
});

assert.equal(matchesBuyMangaFilters(item("ONE PIECE Manga Volume 1", 1, 70), filters), true);
assert.equal(matchesBuyMangaFilters(item("ONE PIECE Manga Volume 11", 11, 70), filters), false, "Volume 11 must not match a search for volume 1");
assert.equal(matchesBuyMangaFilters(item("ONE PIECE Manga Volume 1", 1, 90), filters), false, "The price ceiling applies only within the selected currency");
assert.equal(matchesBuyMangaFilters(item("ONE PIECE Manga Volume 1", 1, 70, { currency: "GBP" }), filters), false);
assert.equal(matchesBuyMangaFilters({ ...item("ONE PIECE Manga Volume 1", 1, 70), edition: { series: "One Piece", title: "One Piece", volume_number: 1, language: "Japanese" } }, filters), false);
assert.equal(matchesBuyMangaFilters(item("ONE PIECE Manga Volume 1", 1, null), { ...filters, maxPrice: null }), true, "Unknown asking prices stay visible when there is no price ceiling");

const sorted = sortBuyMangaItems([item("A", 1, 90), item("B", 1, null), item("C", 1, 50)], "price_asc", "USD");
assert.deepEqual(sorted.map((entry) => entry.lead.listing_title), ["C", "A", "B"]);
console.log("Buy manga search: series/volume, language, currency, price, and sorting passed.");
