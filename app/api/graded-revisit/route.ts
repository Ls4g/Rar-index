import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

type Payload = { leadId?: unknown; disposition?: unknown; reviewer?: unknown; notes?: unknown };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff sign-in is required." }, { status: 401 });
  let payload: Payload;
  try {
    payload = await request.json() as Payload;
  } catch {
    return Response.json({ error: "Send a valid re-review decision." }, { status: 400 });
  }

  const leadId = clean(payload.leadId);
  const disposition = clean(payload.disposition);
  const reviewer = clean(payload.reviewer);
  const notes = clean(payload.notes);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)
    || !["watching", "dismissed"].includes(disposition) || !reviewer || notes.length > 2000) {
    return Response.json({ error: "Choose a graded lead and decision, enter a reviewer, and keep optional notes under 2,000 characters." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin().rpc("revisit_graded_scout_lead", {
    p_lead_id: leadId,
    p_disposition: disposition,
    p_reviewed_by: reviewer,
    p_notes: notes || null,
  });
  if (error) {
    return Response.json({ error: error.message }, { status: 409 });
  }
  return Response.json({ ok: true, decisionId: data });
}
