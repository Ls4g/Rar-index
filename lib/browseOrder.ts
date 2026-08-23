export type BrowseOrderIdentity = {
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  collectible_type: string | null;
  issue_year: number | null;
  issue_number_label: string | null;
  edition_statement?: string | null;
  publisher?: string | null;
};

const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function readableSeries(value: string) {
  const trimmed = value.trim();
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length > 3 && letters === letters.toUpperCase()) {
    return trimmed.toLocaleLowerCase().replace(/(^|[\s-])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toLocaleUpperCase()}`);
  }
  return trimmed;
}

function titleWithoutVolume(title: string) {
  const labelled = title.match(/^(.*?)(?:\s*[,·:\-–—]?\s*(?:vol(?:ume)?|book)\.?\s*\d+(?:\.\d+)?)(?:\b.*)?$/i)?.[1];
  if (labelled?.trim()) return labelled.trim();
  const trailing = title.match(/^(.*\D)\s+(\d+(?:\.\d+)?)$/)?.[1];
  return trailing?.trim() || title.trim();
}

export function browseSeriesName(edition: BrowseOrderIdentity) {
  if (edition.series?.trim()) return readableSeries(edition.series);
  if (edition.collectible_type === "zasshi") return readableSeries(edition.title?.trim() || "Uncategorised");
  return readableSeries(titleWithoutVolume(edition.title?.trim() || "Uncategorised"));
}

export function browseSeriesKey(edition: BrowseOrderIdentity) {
  return browseSeriesName(edition)
    .normalize("NFKC")
    .replace(/[×✕✖]/g, "x")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .toLocaleLowerCase();
}

export function browseVolumeNumber(edition: BrowseOrderIdentity) {
  if (edition.volume_number?.trim()) return edition.volume_number.trim();
  if (edition.collectible_type === "zasshi") return null;
  return edition.title?.match(/(?:vol(?:ume)?|book)\.?\s*(\d+(?:\.\d+)?)/i)?.[1]
    ?? edition.title?.match(/\s(\d+(?:\.\d+)?)$/)?.[1]
    ?? null;
}

function numericVolume(edition: BrowseOrderIdentity) {
  const value = Number.parseFloat(browseVolumeNumber(edition) ?? "");
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function issueNumber(edition: BrowseOrderIdentity) {
  const value = Number.parseFloat(edition.issue_number_label?.match(/\d+(?:\.\d+)?/)?.[0] ?? "");
  return Number.isFinite(value) ? value : -1;
}

function formatRank(edition: BrowseOrderIdentity) {
  return /omnibus|3-in-1/i.test(`${edition.title ?? ""} ${edition.edition_statement ?? ""}`) ? 1 : 0;
}

/** Keep a series shelf readable regardless of when its rows were imported. */
export function compareBrowseEditions(left: BrowseOrderIdentity, right: BrowseOrderIdentity) {
  const leftMagazine = left.collectible_type === "zasshi";
  const rightMagazine = right.collectible_type === "zasshi";
  if (leftMagazine && rightMagazine) {
    return Number(right.issue_year ?? 0) - Number(left.issue_year ?? 0)
      || issueNumber(right) - issueNumber(left)
      || natural.compare(left.title ?? "", right.title ?? "");
  }
  if (leftMagazine !== rightMagazine) return leftMagazine ? 1 : -1;
  return numericVolume(left) - numericVolume(right)
    || natural.compare(left.language ?? "", right.language ?? "")
    || formatRank(left) - formatRank(right)
    || natural.compare(left.title ?? "", right.title ?? "")
    || natural.compare(left.publisher ?? "", right.publisher ?? "");
}
