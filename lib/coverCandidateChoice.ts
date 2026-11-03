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
    || (sourceName === "Penguin Random House" && name.includes("penguin random house"));
}

export function orderCoverChoices<T extends CoverChoice>(candidates: T[], publisher: string | null): T[] {
  return [...candidates].sort((a, b) =>
    Number(b.matchConfidence === "strong") - Number(a.matchConfidence === "strong")
    || Number(isMatchingPublisherCover(b.sourceName, publisher)) - Number(isMatchingPublisherCover(a.sourceName, publisher))
    || b.matchScore - a.matchScore
    || a.sourceName.localeCompare(b.sourceName)
    || a.id.localeCompare(b.id));
}

/** The bulk shortcut may preselect a suggestion, never decide or publish it. */
export function strongestCoverPerEdition<T extends CoverChoice>(candidates: T[], publishers: Map<string, string | null>): T[] {
  const byEdition = new Map<string, T[]>();
  for (const candidate of candidates) {
    byEdition.set(candidate.editionId, [...(byEdition.get(candidate.editionId) ?? []), candidate]);
  }
  return [...byEdition].flatMap(([editionId, choices]) => {
    const strong = orderCoverChoices(choices, publishers.get(editionId) ?? null)
      .find((candidate) => candidate.matchConfidence === "strong");
    return strong ? [strong] : [];
  });
}

export function hasOneCoverPerEdition(choices: Array<{ edition_id: string }>) {
  return new Set(choices.map((choice) => choice.edition_id)).size === choices.length;
}
