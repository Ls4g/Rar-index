import { compareCoverResearchPriority } from "./coveragePriority.ts";

const RESCAN_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * When the set of cover sources last changed.
 *
 * The 24-hour cooldown stops RAR asking the same sources about the same book
 * repeatedly. But a scan is only as good as the providers that existed when it
 * ran, and "checked yesterday, found nothing" says nothing about a source added
 * this morning. Seven VIZ editions were scanned at 19:07 on 20 October, hours
 * before the VIZ provider shipped, and were then locked out of the very source
 * that could fix them until the next evening.
 *
 * So a scan older than this is not treated as recent, whatever the clock says.
 * It costs one extra pass per edition after a provider is added and then stops
 * mattering, because every later scan is newer than the date.
 *
 * Bump this whenever a cover provider is added or materially changed.
 */
export const COVER_PROVIDERS_CHANGED_AT = "2026-10-21T11:00:00.000Z";

export type CoverResearchQueueItem = {
  edition_id: string;
  series: string | null;
  verified_sale_count: number;
};

export function chooseCoverResearchBatch<T extends CoverResearchQueueItem>(
  queue: T[],
  pendingCandidateIds: Set<string>,
  lastScan: Map<string, string>,
  limit: number,
  now = new Date(),
  providersChangedAt = COVER_PROVIDERS_CHANGED_AT,
) {
  let awaitingReview = 0;
  let recentlyChecked = 0;
  const due = queue.filter((edition) => {
    if (pendingCandidateIds.has(edition.edition_id)) {
      awaitingReview += 1;
      return false;
    }
    const scanDate = Date.parse(lastScan.get(edition.edition_id) ?? "");
    const scannedWithCurrentProviders = scanDate >= Date.parse(providersChangedAt);
    if (Number.isFinite(scanDate) && scannedWithCurrentProviders && now.getTime() - scanDate < RESCAN_AFTER_MS) {
      recentlyChecked += 1;
      return false;
    }
    return true;
  });
  due.sort((left, right) => compareCoverResearchPriority(
    { series: left.series, verified_sale_count: left.verified_sale_count, lastScan: lastScan.get(left.edition_id) ?? null },
    { series: right.series, verified_sale_count: right.verified_sale_count, lastScan: lastScan.get(right.edition_id) ?? null },
  ));
  return { editions: due.slice(0, limit), awaitingReview, recentlyChecked, due: due.length };
}
