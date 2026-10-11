type FamilyLead = {
  id: string;
  familyId: string;
  isPrintRun: boolean;
  pending: boolean;
};

// Scout may find the same physical listing through both a publication search
// and a first-print search. It is one human review task, not two editions to
// approve independently. Keep the original lead rows and audit history intact.
export function consolidateGradedRevisitFamilies<T extends FamilyLead>(leads: T[]): T[] {
  const families = new Map<string, T[]>();
  for (const lead of leads) {
    const members = families.get(lead.familyId) ?? [];
    members.push(lead);
    families.set(lead.familyId, members);
  }

  return [...families.values()].map((members) => {
    // A prior decision on either Scout match resolves this listing/family.
    // Otherwise the publication lead is the neutral prefill for the sales form;
    // staff still decides whether this sold copy has first-print proof.
    const selected = members.find((lead) => !lead.pending)
      ?? members.find((lead) => !lead.isPrintRun)
      ?? members[0];
    return { ...selected, pending: members.every((lead) => lead.pending) };
  });
}
