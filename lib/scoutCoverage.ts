import { isPlausibleLiveListing, type PlausibilityEdition } from "./liveListings.ts";
import { looksGraded } from "./editionMatch.ts";
import { coveragePriorityRank } from "./coveragePriority.ts";

export const SCOUT_PUBLIC_LISTING_TARGET = 5;
export const SCOUT_PUBLIC_FRESHNESS_HOURS = 48;
export const SCOUT_MAINTENANCE_SLOTS = 5;

export type ScoutCoverageProfile = {
  id: string;
  last_checked_at: string | null;
  edition: PlausibilityEdition | null;
};

export type ScoutCoverageLead = {
  profile_id: string;
  external_id: string;
  listing_title: string | null;
  item_end_at: string | null;
  last_seen_at: string;
  review_status: string;
};

export type ScoutTriageCoverageLead = {
  id: string;
  editionId: string;
  reviewStatus: string;
  isExpired: boolean;
  isStale: boolean;
  score: number;
  itemEndAt: string | null;
  lastSeenAt: string;
  isGraded?: boolean;
};

function validDate(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function publicListingCoverage(
  profile: ScoutCoverageProfile,
  leads: ScoutCoverageLead[],
  now = new Date(),
) {
  if (!profile.edition) return 0;
  const freshnessCutoff = now.getTime() - SCOUT_PUBLIC_FRESHNESS_HOURS * 60 * 60 * 1000;
  const seen = new Set<string>();

  for (const lead of leads) {
    if (lead.profile_id !== profile.id || seen.has(lead.external_id)) continue;
    if (lead.review_status !== "new" && lead.review_status !== "watching") continue;
    if (looksGraded(lead.listing_title ?? "")) continue;
    const lastSeen = validDate(lead.last_seen_at);
    if (lastSeen === null || lastSeen < freshnessCutoff) continue;
    const endAt = validDate(lead.item_end_at);
    if (endAt !== null && endAt <= now.getTime()) continue;
    if (lead.review_status !== "watching" && !isPlausibleLiveListing(lead, profile.edition)) continue;
    seen.add(lead.external_id);
  }

  return seen.size;
}

function checkedAt(profile: ScoutCoverageProfile) {
  return validDate(profile.last_checked_at) ?? Number.NEGATIVE_INFINITY;
}

function listingEndAt(lead: ScoutTriageCoverageLead) {
  return validDate(lead.itemEndAt) ?? Number.POSITIVE_INFINITY;
}

export function surplusScoutLeadIds(
  leads: ScoutTriageCoverageLead[],
  target = SCOUT_PUBLIC_LISTING_TARGET,
) {
  const byEdition = new Map<string, ScoutTriageCoverageLead[]>();
  for (const lead of leads) {
    if (lead.reviewStatus === "dismissed" || lead.isExpired || lead.isStale || lead.isGraded) continue;
    const rows = byEdition.get(lead.editionId) ?? [];
    rows.push(lead);
    byEdition.set(lead.editionId, rows);
  }

  const surplus = new Set<string>();
  for (const editionLeads of byEdition.values()) {
    const approvedCount = editionLeads.filter((lead) => lead.reviewStatus === "watching").length;
    const availableReviewSlots = Math.max(0, target - approvedCount);
    const candidates = editionLeads
      .filter((lead) => lead.reviewStatus === "new" && lead.score >= 50)
      .sort((left, right) => {
        const scoreDifference = right.score - left.score;
        if (scoreDifference) return scoreDifference;
        const endDifference = listingEndAt(left) - listingEndAt(right);
        if (endDifference) return endDifference;
        return (validDate(right.lastSeenAt) ?? 0) - (validDate(left.lastSeenAt) ?? 0);
      });
    for (const lead of candidates.slice(availableReviewSlots)) surplus.add(lead.id);
  }
  return surplus;
}

export type ScoutProfileSelection<T extends ScoutCoverageProfile> = {
  selected: T[];
  coverageByProfile: Map<string, number>;
  discoverySelected: number;
  maintenanceSelected: number;
  coveredProfiles: number;
};

export function selectScoutProfiles<T extends ScoutCoverageProfile>(
  profiles: T[],
  leads: ScoutCoverageLead[],
  limit: number,
  now = new Date(),
): ScoutProfileSelection<T> {
  const leadsByProfile = new Map<string, ScoutCoverageLead[]>();
  for (const lead of leads) {
    const rows = leadsByProfile.get(lead.profile_id) ?? [];
    rows.push(lead);
    leadsByProfile.set(lead.profile_id, rows);
  }

  const coverageByProfile = new Map<string, number>();
  for (const profile of profiles) {
    coverageByProfile.set(profile.id, publicListingCoverage(profile, leadsByProfile.get(profile.id) ?? [], now));
  }

  const discovery = profiles
    .filter((profile) => (coverageByProfile.get(profile.id) ?? 0) < SCOUT_PUBLIC_LISTING_TARGET)
    .sort((left, right) => {
      const coverageDifference = (coverageByProfile.get(left.id) ?? 0) - (coverageByProfile.get(right.id) ?? 0);
      if (coverageDifference) return coverageDifference;
      const leftRank = coveragePriorityRank(left.edition?.series);
      const rightRank = coveragePriorityRank(right.edition?.series);
      const leftPriority = Number.isFinite(leftRank);
      const rightPriority = Number.isFinite(rightRank);
      if (leftPriority !== rightPriority) return leftPriority ? -1 : 1;
      if (leftPriority && leftRank !== rightRank) return leftRank - rightRank;
      return checkedAt(left) - checkedAt(right);
    });
  const maintenance = profiles
    .filter((profile) => (coverageByProfile.get(profile.id) ?? 0) >= SCOUT_PUBLIC_LISTING_TARGET)
    .sort((left, right) => checkedAt(left) - checkedAt(right));

  const maintenanceLimit = Math.min(SCOUT_MAINTENANCE_SLOTS, maintenance.length, limit);
  const discoveryLimit = Math.min(discovery.length, Math.max(0, limit - maintenanceLimit));
  const selectedDiscovery = discovery.slice(0, discoveryLimit);
  const selectedMaintenance = maintenance.slice(0, maintenanceLimit);
  let selected = [...selectedDiscovery, ...selectedMaintenance];

  if (selected.length < limit) {
    selected = selected.concat(discovery.slice(discoveryLimit, discoveryLimit + (limit - selected.length)));
  }
  return {
    selected,
    coverageByProfile,
    discoverySelected: selected.filter((profile) => (coverageByProfile.get(profile.id) ?? 0) < SCOUT_PUBLIC_LISTING_TARGET).length,
    maintenanceSelected: selected.filter((profile) => (coverageByProfile.get(profile.id) ?? 0) >= SCOUT_PUBLIC_LISTING_TARGET).length,
    coveredProfiles: maintenance.length,
  };
}
