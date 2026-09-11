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

export function approvalStillCoversProposal(
  approved: OpenAgentAction | undefined,
  currentTitle: string,
) {
  // Planning titles include the affected workload count. An unchanged title
  // means the human already approved this exact ask; a changed count is fresh
  // information and deserves a new decision without altering the old audit row.
  return approved?.title === currentTitle;
}
