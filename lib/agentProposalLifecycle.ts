export type OpenAgentAction = {
  id: string;
  dedupe_key: string;
  status: "proposed" | "approved";
  title: string;
};

export function indexOpenAgentActions(actions: OpenAgentAction[]) {
  const proposedByDedupe = new Map<string, OpenAgentAction>();
  const approvedByDedupe = new Map<string, OpenAgentAction>();

  for (const action of actions) {
    const target = action.status === "proposed" ? proposedByDedupe : approvedByDedupe;
    if (!target.has(action.dedupe_key)) target.set(action.dedupe_key, action);
  }

  return { proposedByDedupe, approvedByDedupe };
}

/**
 * Reduce a planning title to the job it describes, dropping the workload
 * count. "Review 86 current, plausible marketplace leads" and "Review 110
 * current, plausible marketplace leads" are the same standing job on two days.
 */
export function planningTitleShape(title: string) {
  return title.replace(/\d[\d,.]*/g, "#").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function approvalStillCoversProposal(
  approved: OpenAgentAction | undefined,
  currentTitle: string,
) {
  if (!approved) return false;
  // Planning titles embed the affected workload count, and that count moves
  // every run. Comparing titles exactly therefore meant a recurring job never
  // matched its own open approval: each run created another action, a human
  // approved it, and the previous approval stayed open forever. By 13
  // September that had produced 26 open approvals covering 14 distinct jobs --
  // four of them the same "triage scout leads" queue.
  //
  // A standing approval covers the same standing job whatever the count, so
  // compare the shape of the title. The count itself is not lost: it is live
  // on the agents dashboard and in each action's evidence.
  //
  // Nothing here alters an approved row. This only decides whether to add
  // another one, so a human decision is never rewritten or closed by a run.
  return planningTitleShape(approved.title) === planningTitleShape(currentTitle);
}
