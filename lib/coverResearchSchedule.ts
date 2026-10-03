import { compareCoverResearchPriority } from "./coveragePriority.ts";

const RESCAN_AFTER_MS = 24 * 60 * 60 * 1000;

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
) {
  let awaitingReview = 0;
  let recentlyChecked = 0;
  const due = queue.filter((edition) => {
    if (pendingCandidateIds.has(edition.edition_id)) {
      awaitingReview += 1;
      return false;
    }
    const scanDate = Date.parse(lastScan.get(edition.edition_id) ?? "");
    if (Number.isFinite(scanDate) && now.getTime() - scanDate < RESCAN_AFTER_MS) {
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
