import { publisherDisplayName } from "./editionDisplay.ts";

export type VolumePublication = {
  id: string;
  number: number;
  publisher: string | null;
  format: string | null;
  language: string | null;
  release_date: string | null;
};

// Sequential volume navigation must stay within the same publisher's physical
// run. A matching story number in another publisher's book is not "next".
export function adjacentPublication<T extends VolumePublication>(current: VolumePublication, candidates: T[], direction: "previous" | "next"): T | null {
  if (!current.publisher || !Number.isFinite(current.number)) return null;
  const publisher = publisherDisplayName(current.publisher).toLocaleLowerCase();
  const eligible = candidates.filter((candidate) =>
    candidate.id !== current.id
    && candidate.language === current.language
    && candidate.publisher
    && publisherDisplayName(candidate.publisher).toLocaleLowerCase() === publisher
    && (direction === "next" ? candidate.number > current.number : candidate.number < current.number));
  eligible.sort((left, right) => {
    const volumeDifference = direction === "next" ? left.number - right.number : right.number - left.number;
    if (volumeDifference) return volumeDifference;
    const leftFormat = Number(Boolean(current.format && left.format && current.format.toLocaleLowerCase() === left.format.toLocaleLowerCase()));
    const rightFormat = Number(Boolean(current.format && right.format && current.format.toLocaleLowerCase() === right.format.toLocaleLowerCase()));
    if (leftFormat !== rightFormat) return rightFormat - leftFormat;
    return (left.release_date ?? "").localeCompare(right.release_date ?? "") || left.id.localeCompare(right.id);
  });
  return eligible[0] ?? null;
}
