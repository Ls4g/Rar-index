import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { isScoutLearningLabel, learningLabelFitsDecision } from "@/lib/scoutDecisionLabels";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

const BULK_CONCURRENCY = 6;

type DecisionResult = { leadId: string; ok: boolean; error?: string };

// A reviewer can select a full page of leads. Sending all of those RPC calls
// at the same instant is unreliable on a serverless request and made bulk
// Watch/Dismiss look like it had done nothing. Keep the operation bounded,
// while still returning an individual result for every audit decision.
async function applyDecisions(
  leadIds: string[],
  apply: (leadId: string) => Promise<DecisionResult>,
) {
  const results: DecisionResult[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < leadIds.length) {
      const leadId = leadIds[nextIndex++];
      results.push(await apply(leadId));
    }
  }

  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, leadIds.length) }, worker));
  return results;
}

// Accepts either one lead (leadId, unchanged single-decision shape) or many
// (leadIds, for the inbox's "Watch selected" / "Dismiss selected" bulk
// actions). Both paths call the same labelled decision RPC once per lead, so
// every decision - bulk or not - gets its own auditable Scout decision row.
// The optional label is evaluation evidence only. Nothing here can verify a
// lead; only "watching" or "dismissed" are valid.
export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: { leadId?: unknown; leadIds?: unknown; decision?: unknown; reviewer?: unknown; notes?: unknown; learningLabel?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid Scout lead decision." }, { status: 400 });
  }

  const requestedLeadIds = Array.isArray(payload.leadIds)
    ? payload.leadIds.map(clean).filter(Boolean)
    : [clean(payload.leadId)].filter(Boolean);
  const leadIds = [...new Set(requestedLeadIds)];
  const decision = clean(payload.decision);
  const reviewer = clean(payload.reviewer);
  const notes = clean(payload.notes);
  const learningLabel = clean(payload.learningLabel);

  if (!leadIds.length || !["watching", "dismissed"].includes(decision) || !reviewer) {
    return Response.json({ error: "Choose watch or dismiss for at least one lead, then identify the reviewer." }, { status: 400 });
  }
  if (learningLabel && (!isScoutLearningLabel(learningLabel) || !learningLabelFitsDecision(learningLabel, decision))) {
    return Response.json({ error: "Choose a learning reason that matches the Scout decision." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  // Grouped listings can include a row already handled by a human under a
  // different collection profile. Leave that row untouched: a bulk action is
  // never allowed to overwrite a prior staff decision.
  const { data: existingLeads, error: existingLeadsError } = await admin
    .from("scout_listing_leads")
    .select("id,review_status")
    .in("id", leadIds);
  if (existingLeadsError || !existingLeads) {
    return Response.json({ error: "Scout leads could not be checked before saving." }, { status: 500 });
  }

  const reviewStatusById = new Map(existingLeads.map((lead) => [lead.id, lead.review_status]));
  const eligibleLeadIds = leadIds.filter((leadId) => reviewStatusById.get(leadId) === "new");
  const protectedResults: DecisionResult[] = leadIds
    .filter((leadId) => reviewStatusById.get(leadId) !== "new")
    .map((leadId) => ({ leadId, ok: false, error: "This Scout lead has already been reviewed." }));

  const results = [
    ...protectedResults,
    ...await applyDecisions(eligibleLeadIds, async (leadId) => {
    try {
      const { error } = await admin.rpc("apply_scout_lead_decision_with_label", {
        p_lead_id: leadId,
        p_decision: decision,
        p_decision_notes: notes,
        p_reviewed_by: reviewer,
        p_learning_label: learningLabel || null,
      });
      return { leadId, ok: !error, error: error?.message };
    } catch {
      return { leadId, ok: false, error: "The database did not accept this Scout decision." };
    }
    }),
  ];

  const failed = results.filter((result) => !result.ok);
  if (failed.length === results.length) {
    return Response.json({ error: "The Scout lead decision could not be saved.", results, failedLeadIds: failed.map((result) => result.leadId) }, { status: 500 });
  }
  return Response.json({
    ok: failed.length === 0,
    saved: results.length - failed.length,
    failed: failed.length,
    failedLeadIds: failed.map((result) => result.leadId),
    results,
  });
}
