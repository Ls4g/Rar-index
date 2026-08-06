// Pricing coverage sprint (2026-08): these series are the current
// operational focus for closing sales-evidence and cover gaps. Shared
// between the Coverage Dashboard and Scout Triage Inbox so "priority
// series" means the same thing in both places. Matched case-insensitively
// since the catalogue has a known casing inconsistency ("One Piece" vs
// "ONE PIECE") on one series.
export const PRIORITY_SERIES = [
  "One Piece",
  "Hunter",
  "Jujutsu Kaisen",
  "Kagurabachi",
  "Naruto",
  "Bleach",
  "Demon Slayer",
  "Attack on Titan",
  "Initial D",
];

export function isPrioritySeries(series: string | null | undefined) {
  const value = (series ?? "").toLocaleLowerCase();
  if (!value) return false;
  return PRIORITY_SERIES.some((target) => value.includes(target.toLocaleLowerCase()));
}
