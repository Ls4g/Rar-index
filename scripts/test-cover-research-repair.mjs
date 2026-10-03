import assert from "node:assert/strict";
import { findDirectOpenLibraryCover } from "../lib/openLibraryCover.ts";
import { chooseCoverResearchBatch } from "../lib/coverResearchSchedule.ts";
import { isFreshListingPhoto } from "../lib/listingPhotoPolicy.ts";

const isbn = "9781591167396"; // Naruto Vol. 6: real book record, omitted record cover.
const direct = await findDirectOpenLibraryCover(isbn, async (url, options) => {
  assert.match(String(url), /\/isbn\/9781591167396-L\.jpg\?default=false$/);
  assert.equal(options?.method, "HEAD");
  return { status: 200, ok: true };
});
assert.match(direct, /9781591167396-L\.jpg/);
assert.equal(await findDirectOpenLibraryCover(isbn, async () => ({ status: 404, ok: false })), null);
await assert.rejects(() => findDirectOpenLibraryCover(isbn, async () => ({ status: 403, ok: false })), /403/);

const now = new Date("2026-10-03T12:00:00.000Z");
const queue = [
  { edition_id: "naruto-6", series: "Naruto", verified_sale_count: 2 },
  { edition_id: "nana-1", series: "Nana", verified_sale_count: 0 },
  { edition_id: "black-jack-1", series: "Black Jack", verified_sale_count: 1 },
  { edition_id: "one-piece-1", series: "One Piece", verified_sale_count: 3 },
];
const schedule = chooseCoverResearchBatch(
  queue,
  new Set(["one-piece-1"]),
  new Map(["naruto-6", "nana-1"].map((id) => [id, "2026-10-03T11:00:00.000Z"])),
  20,
  now,
);
assert.deepEqual(schedule.editions.map((row) => row.edition_id), ["black-jack-1"]);
assert.equal(schedule.awaitingReview, 1);
assert.equal(schedule.recentlyChecked, 2);
assert.equal(schedule.due, 1);
assert.equal(chooseCoverResearchBatch(queue, new Set(), new Map([["naruto-6", "2026-10-02T12:00:00.000Z"]]), 20, now).editions.length, 4);

assert.equal(isFreshListingPhoto("2026-10-03T08:00:00.000Z", now), true);
assert.equal(isFreshListingPhoto("2026-10-03T07:00:00.000Z", now), false);
assert.equal(isFreshListingPhoto("2026-10-04T00:00:00.000Z", now), false);
assert.equal(isFreshListingPhoto(null, now), false);

console.log("cover research repair: direct image, scheduling, and listing-photo freshness passed");
