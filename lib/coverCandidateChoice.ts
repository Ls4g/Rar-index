export type CoverChoice = {
  id: string;
  editionId: string;
  sourceName: string;
  matchConfidence: "strong" | "partial";
  matchScore: number;
};

export function isMatchingPublisherCover(sourceName: string, publisher: string | null) {
  const name = (publisher ?? "").toLocaleLowerCase();
  return (sourceName === "VIZ Media" && /\bviz\b/i.test(name))
    || (sourceName === "Shueisha Direct" && name.includes("shueisha"))
    || (sourceName.startsWith("Kodansha ") && name.includes("kodansha"))
    || (sourceName === "Kodama Tales" && name.includes("kodama"))
    || (sourceName === "Dark Horse" && /dark\s*horse/.test(name))
    || (sourceName === "Penguin Random House" && name.includes("penguin random house"));
}

// The edition's own publisher comes first, then strength. Publisher pages
// rarely print the ISBN, so their match is usually "partial", yet they are
// the best-quality covers and staff have approved them almost without
// exception (to 18 Nov 2026: VIZ 87 approved, 0 rejected; Shueisha Direct 7
// approved, 2 rejected). Only the edition's OWN publisher counts, so another
// edition's artwork cannot win this way.
export function orderCoverChoices<T extends CoverChoice>(candidates: T[], publisher: string | null): T[] {
  return [...candidates].sort((a, b) =>
    Number(isMatchingPublisherCover(b.sourceName, publisher)) - Number(isMatchingPublisherCover(a.sourceName, publisher))
    || Number(b.matchConfidence === "strong") - Number(a.matchConfidence === "strong")
    || b.matchScore - a.matchScore
    || a.sourceName.localeCompare(b.sourceName)
    || a.id.localeCompare(b.id));
}

/**
 * The bulk shortcut may preselect a suggestion, never decide or publish it.
 * Per edition it ticks the cover from the edition's own publisher when there
 * is one (strong or partial: see orderCoverChoices), otherwise the strongest
 * strong match. A partial match from any other source is never preselected.
 */
export function strongestCoverPerEdition<T extends CoverChoice>(candidates: T[], publishers: Map<string, string | null>): T[] {
  const byEdition = new Map<string, T[]>();
  for (const candidate of candidates) {
    byEdition.set(candidate.editionId, [...(byEdition.get(candidate.editionId) ?? []), candidate]);
  }
  return [...byEdition].flatMap(([editionId, choices]) => {
    const publisher = publishers.get(editionId) ?? null;
    const ordered = orderCoverChoices(choices, publisher);
    const pick = ordered.find((candidate) => isMatchingPublisherCover(candidate.sourceName, publisher))
      ?? ordered.find((candidate) => candidate.matchConfidence === "strong");
    return pick ? [pick] : [];
  });
}

export function hasOneCoverPerEdition(choices: Array<{ edition_id: string }>) {
  return new Set(choices.map((choice) => choice.edition_id)).size === choices.length;
}
