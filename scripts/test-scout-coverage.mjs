import assert from "node:assert/strict";
import { buildMarketplaceQuery } from "../lib/marketplaceQuery.ts";
import { canSeedScoutProfile } from "../lib/scoutProfileSeed.ts";
import { publicListingCoverage, selectScoutProfiles } from "../lib/scoutCoverage.ts";

const now = new Date("2026-08-24T12:00:00.000Z");
const edition = { title: "One Piece 1", series: "One Piece", volume_number: 1, language: "Japanese", isbn_13: "9784088725093", publisher: "Shueisha", format: "Paperback" };
const profile = { id: "p1", last_checked_at: null, edition };
const lead = (overrides = {}) => ({ profile_id: "p1", external_id: "e1", listing_title: "One Piece manga Vol 1 Shueisha", item_end_at: null, last_seen_at: "2026-08-24T11:00:00.000Z", review_status: "new", ...overrides });

assert.equal(publicListingCoverage(profile, [lead() ], now), 1, "a plausible fresh listing counts");
assert.equal(publicListingCoverage(profile, [lead({ review_status: "watching", listing_title: "seller shorthand" })], now), 1, "a human-watched listing counts");
assert.equal(publicListingCoverage(profile, [lead({ last_seen_at: "2026-08-20T11:00:00.000Z" })], now), 0, "stale listings do not count");
assert.equal(publicListingCoverage(profile, [lead({ item_end_at: "2026-08-24T10:00:00.000Z" })], now), 0, "ended listings do not count");
assert.equal(publicListingCoverage(profile, [lead(), lead()], now), 1, "duplicate marketplace items count once");
assert.equal(publicListingCoverage(profile, [lead({ listing_title: "One Piece manga Vol 8 Shueisha" })], now), 0, "the wrong volume does not count");

const profiles = [
  { ...profile, id: "zero", last_checked_at: "2026-08-20T00:00:00Z" },
  { ...profile, id: "partial", last_checked_at: "2026-08-19T00:00:00Z" },
  { ...profile, id: "covered", last_checked_at: "2026-08-18T00:00:00Z" },
];
const leads = [
  ...Array.from({ length: 2 }, (_, index) => lead({ profile_id: "partial", external_id: `partial-${index}` })),
  ...Array.from({ length: 5 }, (_, index) => lead({ profile_id: "covered", external_id: `covered-${index}` })),
];
const selection = selectScoutProfiles(profiles, leads, 2, now);
assert.deepEqual(selection.selected.map((item) => item.id), ["zero", "covered"], "discovery starts at zero while a maintenance slot preserves covered profiles");
assert.equal(selection.discoverySelected, 1);
assert.equal(selection.maintenanceSelected, 1);

const seedEdition = { ...edition, id: "edition", printing_number: 1, collectible_type: "tankobon", record_kind: "publication" };
assert.equal(canSeedScoutProfile(seedEdition), true, "a complete verified publication can receive a profile");
assert.equal(canSeedScoutProfile({ ...seedEdition, isbn_13: null }), false, "incomplete identity data is not auto-profiled");
assert.equal(canSeedScoutProfile({ ...seedEdition, collectible_type: "zasshi" }), false, "magazines are not forced into manga searches");
const query = buildMarketplaceQuery(seedEdition);
assert.match(query, /manga/i);
assert.match(query, /Vol\. 1/i);
assert.match(query, /9784088725093/);
assert.doesNotMatch(query, /[\"“”]/);

console.log("Scout coverage tests passed.");
