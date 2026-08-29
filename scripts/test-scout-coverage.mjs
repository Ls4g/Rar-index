import assert from "node:assert/strict";
import { buildMarketplaceQuery } from "../lib/marketplaceQuery.ts";
import { canSeedScoutProfile } from "../lib/scoutProfileSeed.ts";
import { publicListingCoverage, SCOUT_MAINTENANCE_SLOTS, selectScoutProfiles, surplusScoutLeadIds } from "../lib/scoutCoverage.ts";

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
assert.equal(publicListingCoverage(profile, [lead({ listing_title: "CGC 9.0 One Piece manga Vol 1 Shueisha graded" })], now), 0, "graded copies do not fill the raw-listing target");

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

const maintenanceProfiles = Array.from({ length: 7 }, (_, index) => ({
  ...profile,
  id: `maintenance-${index}`,
  last_checked_at: `2026-08-${String(10 + index).padStart(2, "0")}T00:00:00Z`,
}));
const maintenanceLeads = maintenanceProfiles.flatMap((maintenanceProfile) =>
  Array.from({ length: 5 }, (_, index) => lead({ profile_id: maintenanceProfile.id, external_id: `${maintenanceProfile.id}-${index}` })),
);
const cappedMaintenance = selectScoutProfiles(maintenanceProfiles, maintenanceLeads, 10, now);
assert.equal(SCOUT_MAINTENANCE_SLOTS, 5);
assert.equal(cappedMaintenance.selected.length, 5, "covered profiles never consume more than five maintenance searches");
assert.equal(cappedMaintenance.maintenanceSelected, 5);

const triageLead = (id, overrides = {}) => ({
  id,
  editionId: "edition-a",
  reviewStatus: "new",
  isExpired: false,
  isStale: false,
  score: 70,
  itemEndAt: null,
  lastSeenAt: "2026-08-24T11:00:00.000Z",
  ...overrides,
});
const sevenNewLeads = Array.from({ length: 7 }, (_, index) => triageLead(`new-${index}`, { score: 70 - index }));
assert.deepEqual([...surplusScoutLeadIds(sevenNewLeads)].sort(), ["new-5", "new-6"], "only the five strongest new listings stay in the priority queue");
const coveredByStaff = [
  ...Array.from({ length: 5 }, (_, index) => triageLead(`watching-${index}`, { reviewStatus: "watching" })),
  triageLead("new-backup"),
];
assert.deepEqual([...surplusScoutLeadIds(coveredByStaff)], ["new-backup"], "new listings become backups after five staff-watched listings");
assert.equal(surplusScoutLeadIds([...sevenNewLeads, triageLead("graded", { isGraded: true, score: 99 })]).has("graded"), false, "graded copies stay in their own backlog instead of consuming raw coverage");
assert.equal(surplusScoutLeadIds([triageLead("stale", { isStale: true }), triageLead("expired", { isExpired: true })]).size, 0, "stale and expired queues remain independent");

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
