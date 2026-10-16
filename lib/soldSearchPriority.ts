import { coveragePriorityRank } from "./coveragePriority.ts";

export type SoldSearchCandidate = {
  profileId: string;
  editionId: string;
  query: string;
  title: string;
  series: string | null;
  volumeNumber: string | number | null;
  language: string | null;
  collectibleType: string | null;
  comparableRawSales: number;
  targetPrintGroup?: string | null;
};

type PublicationRecord = { id: string; printing_of_edition_id: string | null };
type RawSaleRecord = {
  edition_id: string;
  print_classification: string | null;
  known_printing_number: number | null;
  grading_company: string | null;
  grade_label: string | null;
};

export function publicationIdByEdition(editions: PublicationRecord[]) {
  return new Map(editions.map((edition) => [edition.id, edition.printing_of_edition_id ?? edition.id]));
}

// A publication and its documented print runs share one public market page.
// Count a sale in its actual print group, but across that whole family; never
// count a graded sale toward the raw-copy search target.
export function leadingRawSaleGroupsByPublication(editions: PublicationRecord[], sales: RawSaleRecord[]) {
  const publicationByEdition = publicationIdByEdition(editions);
  const groups = new Map<string, Map<string, number>>();
  for (const sale of sales) {
    if (sale.grading_company || sale.grade_label) continue;
    const publicationId = publicationByEdition.get(sale.edition_id);
    if (!publicationId) continue;
    const classification = sale.print_classification === "known_later_print"
      ? `known_later_print:${sale.known_printing_number ?? "unknown"}`
      : sale.print_classification ?? "printing_not_identified";
    const counts = groups.get(publicationId) ?? new Map<string, number>();
    counts.set(classification, (counts.get(classification) ?? 0) + 1);
    groups.set(publicationId, counts);
  }
  return new Map([...groups].map(([publicationId, counts]) => {
    // A fully covered first-print line must not conceal an under-covered
    // unidentified or later-print line on the same publication.
    const openGroups = [...counts].filter(([, count]) => count < 5);
    const [classification, count] = (openGroups.length ? openGroups : [...counts]).sort((left, right) =>
      right[1] - left[1] || Number(right[0] === "first_print_proven") - Number(left[0] === "first_print_proven") || left[0].localeCompare(right[0]))[0];
    return [publicationId, { classification, count }] as const;
  }));
}

export function comparableRawSalesByPublication(editions: PublicationRecord[], sales: RawSaleRecord[]) {
  return new Map([...leadingRawSaleGroupsByPublication(editions, sales)].map(([id, group]) => [id, group.count]));
}

// Search one publication once. Prefer a targeted first-print query only when
// that is the group closest to its next milestone; otherwise search broadly.
export function oneSearchPerPublication<T extends { edition_id: string; search_query?: string }>(profiles: T[], editions: PublicationRecord[], targetGroups?: Map<string, { classification: string; count: number }>) {
  const publicationByEdition = publicationIdByEdition(editions);
  const selected = new Map<string, T>();
  for (const profile of profiles) {
    const publicationId = publicationByEdition.get(profile.edition_id);
    if (!publicationId) continue;
    const current = selected.get(publicationId);
    const rank = (value: T) => targetGroups?.get(publicationId)?.classification === "first_print_proven"
      && /\bfirst[\s-]*(?:print|printing|edition)\b/i.test(value.search_query ?? "") ? 0
      : value.edition_id === publicationId ? 1 : 2;
    if (!current || rank(profile) < rank(current)) {
      selected.set(publicationId, profile);
    }
  }
  return [...selected.values()];
}

function isManga(candidate: SoldSearchCandidate) {
  return (candidate.collectibleType ?? "tankobon") === "tankobon";
}

function priorityLane(candidate: SoldSearchCandidate) {
  return isManga(candidate) ? 0 : 1;
}

function evidenceRank(count: number) {
  // Consolidate evidence before widening it: first finish publications that
  // are one sale from strong coverage, then unlock a chart for publications
  // that already have two comparable sales.
  if (count === 4) return 0;
  if (count === 2) return 1;
  if (count === 3) return 2;
  if (count === 1) return 3;
  if (count === 0) return 4;
  return 4;
}

export function prioritiseSoldSearches(candidates: SoldSearchCandidate[], limit = 10) {
  return candidates
    .filter((candidate) => candidate.query.trim() && candidate.comparableRawSales < 5)
    .sort((left, right) => {
      const laneDifference = priorityLane(left) - priorityLane(right);
      if (laneDifference) return laneDifference;
      const evidenceDifference = evidenceRank(left.comparableRawSales) - evidenceRank(right.comparableRawSales);
      if (evidenceDifference) return evidenceDifference;
      const priorityDifference = coveragePriorityRank(left.series) - coveragePriorityRank(right.series);
      if (Number.isFinite(priorityDifference) && priorityDifference) return priorityDifference;
      return left.title.localeCompare(right.title) || String(left.language ?? "").localeCompare(String(right.language ?? ""));
    })
    .slice(0, Math.max(0, limit));
}

export function soldSearchReason(count: number, collectibleType: string | null = "tankobon") {
  if ((collectibleType ?? "tankobon") === "tankobon" && count === 0) return "Needs three verified raw sales to unlock a chart";
  if (count === 2) return "One verified raw sale could unlock its chart";
  if (count === 4) return "One verified raw sale reaches strong coverage";
  if (count === 1) return "Two more verified raw sales could unlock a chart";
  if (count === 3) return "Chart ready; two more sales reach strong coverage";
  return "No verified raw sale yet";
}

export function ebayCompletedSearchUrl(query: string) {
  return `https://www.ebay.co.uk/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
}
