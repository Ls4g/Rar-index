import assert from "node:assert/strict";
import { selectHomeLiveListings } from "../lib/homeLiveListings.ts";

const now = new Date("2026-10-17T12:00:00Z");
const editions = [
  { id: "op-1", title: "One Piece", series: "One Piece", volume_number: "1", language: "English", publisher: "VIZ Media", format: "Paperback", isbn_13: "9781569319017", cover_image_url: "https://example.com/op.jpg", cover_verification_status: "verified" },
  { id: "op-2", title: "One Piece", series: "One Piece", volume_number: "2", language: "English", publisher: "VIZ Media", format: "Paperback", isbn_13: null, cover_image_url: "https://example.com/op2.jpg", cover_verification_status: "verified" },
  { id: "op-3", title: "One Piece", series: "One Piece", volume_number: "3", language: "English", publisher: "VIZ Media", format: "Paperback", isbn_13: null, cover_image_url: "https://example.com/op3.jpg", cover_verification_status: "verified" },
  { id: "hxh-1", title: "Hunter × Hunter", series: "Hunter × Hunter", volume_number: "1", language: "English", publisher: "VIZ Media", format: "Paperback", isbn_13: null, cover_image_url: "https://example.com/hxh.jpg", cover_verification_status: "verified" },
  { id: "no-cover", title: "Naruto", series: "Naruto", volume_number: "1", language: "English", publisher: "VIZ Media", format: "Paperback", isbn_13: null, cover_image_url: null, cover_verification_status: "unverified" },
];
const profiles = editions.map((edition) => ({ id: `profile-${edition.id}`, edition_id: edition.id }));
const lead = (id, editionId, overrides = {}) => ({
  id, external_id: id, profile_id: `profile-${editionId}`, review_status: "watching",
  source_listing_url: `https://www.ebay.co.uk/itm/${id}`,
  listing_title: `${editionId} manga`, listing_price: 12.5, currency: "GBP",
  item_end_at: null, last_seen_at: "2026-10-17T11:00:00Z", ...overrides,
});

const selected = selectHomeLiveListings([
  lead("fresh", "op-1"),
  lead("duplicate", "op-1", { external_id: "fresh" }),
  lead("expired", "hxh-1", { item_end_at: "2026-10-16T11:00:00Z" }),
  lead("stale", "hxh-1", { last_seen_at: "2026-10-14T11:00:00Z" }),
  lead("wrong-volume", "hxh-1", { review_status: "new", listing_title: "Hunter x Hunter Vol. 8 VIZ Media" }),
  lead("good-new", "hxh-1", { review_status: "new", listing_title: "Hunter x Hunter Vol. 1 VIZ Media paperback" }),
  lead("op-2", "op-2"), lead("op-3", "op-3"),
  lead("no-cover", "no-cover"),
  lead("free", "hxh-1", { listing_price: 0 }),
], profiles, editions, now);
assert.deepEqual(selected.map((item) => item.id), ["fresh", "good-new", "op-2"]);
assert.equal(selected[0].askingPrice, 12.5);
assert.equal(selectHomeLiveListings([lead("fresh", "op-1")], profiles, editions, now, 1).length, 1);
console.log("Homepage live listing selection: passed");
