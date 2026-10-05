// Match the daily Scout worker's bounded parallelism. Running twenty profiles
// serially can outlive the staff request and strand an approved action's lease.
export const SCOUT_BATCH_CONCURRENCY = 4;

export async function mapScoutBatch<T, R>(profiles: T[], scanProfile: (profile: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let offset = 0; offset < profiles.length; offset += SCOUT_BATCH_CONCURRENCY) {
    results.push(...await Promise.all(profiles.slice(offset, offset + SCOUT_BATCH_CONCURRENCY).map(scanProfile)));
  }
  return results;
}
