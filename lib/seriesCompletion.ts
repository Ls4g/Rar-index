// "You own 7 of 24" — the most natural thing RAR can say to a collector, and
// the one that needs no pricing evidence at all to be useful.
//
// The denominator is deliberately *what RAR tracks*, never what the series
// actually contains. RAR knows one volume of One Piece; the series has over a
// hundred. Reporting "1 of 1" as though the set were complete would be a
// straightforward lie, so every caller must label the figure as RAR's
// coverage rather than the series' length. See SeriesProgress for the wording.

export type CatalogueVolume = {
  id: string;
  title: string | null;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  coverImageUrl: string | null;
  coverStatus: string | null;
};

export type SeriesVolume = {
  editionId: string;
  label: string;
  sortValue: number | null;
  owned: boolean;
  title: string | null;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  coverImageUrl: string | null;
  coverStatus: string | null;
};

export type SeriesProgressEntry = {
  key: string;
  series: string;
  language: string | null;
  tracked: number;
  owned: number;
  volumes: SeriesVolume[];
};

// Volume numbers are free text in the catalogue — "1", "01", "Vol. 3",
// "3.5" all occur — so ordering reads the first number present and leaves
// anything without one at the end rather than guessing a position.
export function volumeSortValue(value: string | null | undefined): number | null {
  const match = String(value ?? "").match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function groupKey(series: string, language: string | null) {
  return `${series.toLowerCase().replace(/[^a-z0-9]/g, "")}::${(language ?? "").toLowerCase()}`;
}

/**
 * Groups the catalogue into series (per language, because an English Vol. 2
 * does not continue a Japanese Vol. 1 — they are different books) and marks
 * which volumes the given owner holds.
 */
export function buildSeriesProgress(
  catalogue: CatalogueVolume[],
  ownedEditionIds: Iterable<string>,
): SeriesProgressEntry[] {
  const owned = ownedEditionIds instanceof Set ? ownedEditionIds : new Set(ownedEditionIds);
  const groups = new Map<string, SeriesProgressEntry>();

  for (const edition of catalogue) {
    const series = (edition.series || edition.title || "").trim();
    if (!series) continue;
    const key = groupKey(series, edition.language);
    const entry = groups.get(key) ?? {
      key,
      series,
      language: edition.language,
      tracked: 0,
      owned: 0,
      volumes: [],
    };
    const isOwned = owned.has(edition.id);
    entry.volumes.push({
      editionId: edition.id,
      label: edition.volumeNumber?.trim() || "—",
      sortValue: volumeSortValue(edition.volumeNumber),
      owned: isOwned,
      title: edition.title,
      series: edition.series,
      volumeNumber: edition.volumeNumber,
      language: edition.language,
      coverImageUrl: edition.coverImageUrl,
      coverStatus: edition.coverStatus,
    });
    entry.tracked += 1;
    if (isOwned) entry.owned += 1;
    groups.set(key, entry);
  }

  for (const entry of groups.values()) {
    entry.volumes.sort((left, right) => {
      if (left.sortValue === null && right.sortValue === null) return left.label.localeCompare(right.label);
      if (left.sortValue === null) return 1;
      if (right.sortValue === null) return -1;
      return left.sortValue - right.sortValue;
    });
  }

  // Series the collector is furthest into come first — that is the one they
  // are most likely to want to finish.
  return [...groups.values()].sort((left, right) => {
    if (right.owned !== left.owned) return right.owned - left.owned;
    if (right.tracked !== left.tracked) return right.tracked - left.tracked;
    return left.series.localeCompare(right.series);
  });
}
