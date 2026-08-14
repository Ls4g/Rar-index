// One marketplace item may be found by several profiles for the same exact
// RAR edition. Those can be triaged together. The same item found for two
// different editions must remain two decisions because one may match while
// the other conflicts.
export function scoutListingGroupKey(sourceId: string, externalId: string, editionId: string | null | undefined, profileId: string) {
  return `${sourceId}:${externalId}:${editionId ?? `profile-${profileId}`}`;
}
