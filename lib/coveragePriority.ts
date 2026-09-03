// SP's September 2026 coverage wave. Kept separate from catalogue gap
// expansion: these titles get their Volume 1 pages strengthened without
// causing Volume 2+ records to be created prematurely.
export const COVERAGE_PRIORITY_SERIES = [
  "One Piece", "Doraemon", "Golgo 13", "Case Closed", "Dragon Ball",
  "Naruto", "Demon Slayer: Kimetsu no Yaiba", "Slam Dunk",
  "KochiKame: Tokyo Beat Cops", "Jujutsu Kaisen", "Crayon Shin-chan",
  "Attack on Titan", "Oishinbo", "Bleach", "JoJo's Bizarre Adventure",
  "Kingdom", "Astro Boy", "Baki the Grappler", "Fist of the North Star",
  "Hajime no Ippo", "Hunter x Hunter", "The Kindaichi Case Files",
  "My Hero Academia", "Touch", "Captain Tsubasa",
  // Existing strategic RAR subjects retained from the earlier sprint.
  "Kagurabachi", "Initial D",
] as const;

const ALIASES: Record<string, readonly string[]> = {
  "case closed": ["detective conan", "meitantei conan"],
  "demon slayer kimetsu no yaiba": ["demon slayer", "kimetsu no yaiba"],
  "kochikame tokyo beat cops": ["kochikame"],
  "attack on titan": ["shingeki no kyojin"],
  "jojos bizarre adventure": ["jojo no kimyo na boken"],
  "astro boy": ["tetsuwan atom"],
  "baki the grappler": ["grappler baki"],
  "fist of the north star": ["hokuto no ken"],
  "hunter x hunter": ["hunter hunter"],
  "the kindaichi case files": ["kindaichi case files", "kindaichi shonen no jikenbo"],
  "my hero academia": ["boku no hero academia"],
};

export const STRONG_COVERAGE_SALE_TARGET = 5;

export function normalizeCoverageSeries(value: string | null | undefined) {
  return (value ?? "").normalize("NFKD").toLocaleLowerCase()
    .replace(/[×]/g, "x").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

function namesForPriority(priority: string) {
  const normalized = normalizeCoverageSeries(priority);
  return [normalized, ...(ALIASES[normalized] ?? []).map(normalizeCoverageSeries)];
}

export function coveragePriorityRank(series: string | null | undefined) {
  const normalized = normalizeCoverageSeries(series);
  if (!normalized) return Number.POSITIVE_INFINITY;
  const index = COVERAGE_PRIORITY_SERIES.findIndex((priority) => namesForPriority(priority).includes(normalized));
  return index < 0 ? Number.POSITIVE_INFINITY : index;
}

export function isCoveragePrioritySeries(series: string | null | undefined) {
  return Number.isFinite(coveragePriorityRank(series));
}

export function coverageStrength(input: { coverVerified: boolean; hasActiveProfile: boolean; comparableSaleCount: number }) {
  const completed = Number(input.coverVerified) + Number(input.hasActiveProfile)
    + Number(input.comparableSaleCount >= STRONG_COVERAGE_SALE_TARGET);
  const saleGap = Math.max(0, STRONG_COVERAGE_SALE_TARGET - input.comparableSaleCount);
  const missing = [
    input.coverVerified ? null : "verified cover",
    input.hasActiveProfile ? null : "marketplace profile",
    saleGap ? `${saleGap} comparable sale${saleGap === 1 ? "" : "s"}` : null,
  ].filter((value): value is string => Boolean(value));
  return { completed, total: 3, strong: completed === 3, missing };
}

export type CoverResearchPriorityRow = {
  series: string | null;
  verified_sale_count: number;
  lastScan: string | null;
};

export function compareCoverResearchPriority(left: CoverResearchPriorityRow, right: CoverResearchPriorityRow) {
  const leftRank = coveragePriorityRank(left.series);
  const rightRank = coveragePriorityRank(right.series);
  const leftPriority = Number.isFinite(leftRank);
  const rightPriority = Number.isFinite(rightRank);
  if (leftPriority !== rightPriority) return leftPriority ? -1 : 1;
  if (!left.lastScan && right.lastScan) return -1;
  if (left.lastScan && !right.lastScan) return 1;
  if (left.lastScan && right.lastScan && left.lastScan !== right.lastScan) return left.lastScan.localeCompare(right.lastScan);
  if (leftPriority && leftRank !== rightRank) return leftRank - rightRank;
  return right.verified_sale_count - left.verified_sale_count;
}
