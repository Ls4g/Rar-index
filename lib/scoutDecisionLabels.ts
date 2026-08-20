export const WATCH_LEARNING_LABELS = [
  { value: "exact_match", label: "Exact copy" },
  { value: "interesting_opportunity", label: "Interesting opportunity" },
  { value: "other_watch", label: "Other reason" },
] as const;

export const DISMISS_LEARNING_LABELS = [
  { value: "edition_mismatch", label: "Wrong edition" },
  { value: "printing_unproven", label: "First print not proven" },
  { value: "graded_not_raw", label: "Graded, not raw" },
  { value: "multi_volume_lot", label: "Lot or set" },
  { value: "duplicate_listing", label: "Duplicate" },
  { value: "unavailable", label: "Ended or unavailable" },
  { value: "poor_value", label: "Poor value" },
  { value: "other_dismiss", label: "Other reason" },
] as const;

export type ScoutLearningLabel =
  | (typeof WATCH_LEARNING_LABELS)[number]["value"]
  | (typeof DISMISS_LEARNING_LABELS)[number]["value"];

const WATCH_VALUES = new Set<string>(WATCH_LEARNING_LABELS.map((item) => item.value));
const DISMISS_VALUES = new Set<string>(DISMISS_LEARNING_LABELS.map((item) => item.value));

export function isScoutLearningLabel(value: string): value is ScoutLearningLabel {
  return WATCH_VALUES.has(value) || DISMISS_VALUES.has(value);
}

export function learningLabelFitsDecision(value: string, decision: string) {
  if (!value) return true;
  if (decision === "watching") return WATCH_VALUES.has(value);
  if (decision === "dismissed") return DISMISS_VALUES.has(value);
  return false;
}

export function learningLabelName(value: string | null | undefined) {
  if (!value) return null;
  return [...WATCH_LEARNING_LABELS, ...DISMISS_LEARNING_LABELS].find((item) => item.value === value)?.label ?? value;
}

