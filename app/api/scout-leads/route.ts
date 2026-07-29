import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: { leadId?: unknown; decision?: unknown; reviewer?: unknown; notes?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid Scout lead decision." }, { status: 400 });
  }
  const leadId = clean(payload.leadId);
  const decision = clean(payload.decision);
  const reviewer = clean(payload.reviewer);
  const notes = clean(payload.notes);
  if (!leadId || !["watching", "dismissed"].includes(decision) || !reviewer || notes.length < 12) {
    return Response.json({ error: "Choose watch or dismiss, identify the reviewer, and add at least 12 characters of evidence." }, { status: 400 });
  }
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc("apply_scout_lead_decision", {
    p_lead_id: leadId,
    p_decision: decision,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
  });
  if (error) return Response.json({ error: "The Scout lead decision could not be saved." }, { status: 500 });
  return Response.json({ ok: true });
}
