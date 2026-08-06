import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// Accepts either one lead (leadId, unchanged single-decision shape) or many
// (leadIds, for the inbox's "Watch selected" / "Dismiss selected" bulk
// actions). Both paths call the same apply_scout_lead_decision RPC once per
// lead, so every decision — bulk or not — gets its own auditable
// scout_lead_decisions row and the same reviewer/notes validation. Nothing
// here can verify a lead; only "watching" or "dismissed" are valid.
export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: { leadId?: unknown; leadIds?: unknown; decision?: unknown; reviewer?: unknown; notes?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid Scout lead decision." }, { status: 400 });
  }

  const leadIds = Array.isArray(payload.leadIds)
    ? payload.leadIds.map(clean).filter(Boolean)
    : [clean(payload.leadId)].filter(Boolean);
  const decision = clean(payload.decision);
  const reviewer = clean(payload.reviewer);
  const notes = clean(payload.notes);

  if (!leadIds.length || !["watching", "dismissed"].includes(decision) || !reviewer) {
    return Response.json({ error: "Choose watch or dismiss for at least one lead, then identify the reviewer." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const results = await Promise.all(leadIds.map(async (leadId) => {
    const { error } = await admin.rpc("apply_scout_lead_decision", {
      p_lead_id: leadId,
      p_decision: decision,
      p_decision_notes: notes,
      p_reviewed_by: reviewer,
    });
    return { leadId, ok: !error, error: error?.message };
  }));

  const failed = results.filter((result) => !result.ok);
  if (failed.length === results.length) {
    return Response.json({ error: "The Scout lead decision could not be saved.", results }, { status: 500 });
  }
  return Response.json({ ok: true, saved: results.length - failed.length, failed: failed.length, results });
}
