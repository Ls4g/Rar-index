import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

const decisions = ["queued_for_research", "declined", "added_to_catalogue"] as const;

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: { requestId?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown };
  try { payload = await request.json() as { requestId?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown }; } catch { return Response.json({ error: "Send a valid request decision." }, { status: 400 }); }
  const requestId = typeof payload.requestId === "string" ? payload.requestId : "";
  const decision = typeof payload.decision === "string" ? payload.decision : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";
  if (!requestId || !decisions.includes(decision as typeof decisions[number]) || !reviewer) return Response.json({ error: "Choose a decision and identify the reviewer." }, { status: 400 });
  try {
    const { error } = await getSupabaseAdmin().rpc("apply_catalogue_request_decision", { p_request_id: requestId, p_decision: decision, p_decision_notes: notes, p_reviewed_by: reviewer });
    if (error) return Response.json({ error: "RAR could not save this decision." }, { status: 500 });
    return Response.json({ ok: true });
  } catch { return Response.json({ error: "RAR request review is temporarily unavailable." }, { status: 503 }); }
}
