export const OUTCOME_HUMAN_RECHECK_DAYS = 14;

export function outcomeHumanSnoozedUntil(now: Date | string = new Date()) {
  const value = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(value.getTime())) throw new Error("A valid decision time is required.");
  return new Date(value.getTime() + OUTCOME_HUMAN_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export function outcomeNeedsHumanAttention(input: {
  status: string;
  humanAttentionSnoozedUntil: string | null;
}, now: Date | string = new Date()) {
  if (input.status === "sold_candidate") return true;
  if (!input.humanAttentionSnoozedUntil) return true;
  const current = now instanceof Date ? now : new Date(now);
  return new Date(input.humanAttentionSnoozedUntil).getTime() <= current.getTime();
}
