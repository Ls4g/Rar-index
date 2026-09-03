import { coveragePriorityRank } from "./coveragePriority.ts";

export type SoldSearchCandidate = {
  profileId: string;
  editionId: string;
  query: string;
  title: string;
  series: string | null;
  volumeNumber: string | number | null;
  language: string | null;
  comparableRawSales: number;
};

function evidenceRank(count: number) {
  if (count === 2) return 0;
  if (count === 4) return 1;
  if (count === 1) return 2;
  if (count === 3) return 3;
  return 4;
}

export function prioritiseSoldSearches(candidates: SoldSearchCandidate[], limit = 10) {
  return candidates
    .filter((candidate) => candidate.query.trim() && candidate.comparableRawSales < 5)
    .sort((left, right) => {
      const evidenceDifference = evidenceRank(left.comparableRawSales) - evidenceRank(right.comparableRawSales);
      if (evidenceDifference) return evidenceDifference;
      const priorityDifference = coveragePriorityRank(left.series) - coveragePriorityRank(right.series);
      if (Number.isFinite(priorityDifference) && priorityDifference) return priorityDifference;
      return left.title.localeCompare(right.title) || String(left.language ?? "").localeCompare(String(right.language ?? ""));
    })
    .slice(0, Math.max(0, limit));
}

export function soldSearchReason(count: number) {
  if (count === 2) return "One verified raw sale could unlock its chart";
  if (count === 4) return "One verified raw sale reaches strong coverage";
  if (count === 1) return "Two more verified raw sales could unlock a chart";
  if (count === 3) return "Chart ready; one more sale strengthens it";
  return "No verified raw sale yet";
}

export function ebayCompletedSearchUrl(query: string) {
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
}
