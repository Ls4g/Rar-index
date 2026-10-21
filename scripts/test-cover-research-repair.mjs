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
// The provider set is treated as unchanged for these cases, so they test the
// plain 24-hour cooldown on its own.
const SETTLED = "2026-01-01T00:00:00.000Z";
const schedule = chooseCoverResearchBatch(
  queue,
  new Set(["one-piece-1"]),
  new Map(["naruto-6", "nana-1"].map((id) => [id, "2026-10-03T11:00:00.000Z"])),
  20,
  now,
  SETTLED,
);
assert.deepEqual(schedule.editions.map((row) => row.edition_id), ["black-jack-1"]);
assert.equal(schedule.awaitingReview, 1);
assert.equal(schedule.recentlyChecked, 2);
assert.equal(schedule.due, 1);
assert.equal(chooseCoverResearchBatch(queue, new Set(), new Map([["naruto-6", "2026-10-02T12:00:00.000Z"]]), 20, now, SETTLED).editions.length, 4);

// A scan is only as good as the providers that existed when it ran. Seven VIZ
// editions were scanned at 19:07 on 20 October, hours before the VIZ provider
// shipped, and the cooldown then locked them out of the one source that could
// fix them for another day. A scan older than the provider set is not recent.
const addedProviderAt = "2026-10-03T11:30:00.000Z";
const afterNewProvider = chooseCoverResearchBatch(
  queue,
  new Set(),
  new Map([
    ["naruto-6", "2026-10-03T11:00:00.000Z"],  // half an hour old, but pre-dates the new provider
    ["nana-1", "2026-10-03T11:45:00.000Z"],    // ran with the new provider, so genuinely recent
  ]),
  20,
  now,
  addedProviderAt,
);
assert.ok(
  afterNewProvider.editions.some((row) => row.edition_id === "naruto-6"),
  "a scan predating a new provider must be re-run, however recent the clock says it is",
);
assert.ok(
  !afterNewProvider.editions.some((row) => row.edition_id === "nana-1"),
  "a scan that already ran with the current providers stays on cooldown",
);
assert.equal(afterNewProvider.recentlyChecked, 1);

assert.equal(isFreshListingPhoto("2026-10-03T08:00:00.000Z", now), true);
assert.equal(isFreshListingPhoto("2026-10-03T07:00:00.000Z", now), false);
assert.equal(isFreshListingPhoto("2026-10-04T00:00:00.000Z", now), false);
assert.equal(isFreshListingPhoto(null, now), false);

console.log("cover research repair: direct image, scheduling, and listing-photo freshness passed");
