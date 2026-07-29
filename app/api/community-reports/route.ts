import { createClient } from "@supabase/supabase-js";

type Decision = "reviewed" | "rejected" | "converted";

function isStaffRequest(request: Request) {
  const authorization = request.headers.get("authorization");
  const username = process.env.RAR_REVIEW_USERNAME;
  const password = process.env.RAR_REVIEW_PASSWORD;
  if (!username || !password || !authorization?.startsWith("Basic ")) return false;
  try {
    const [providedUsername, providedPassword] = atob(authorization.slice(6)).split(":");
    return providedUsername === username && providedPassword === password;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return Response.json({ error: "Community report review is not configured yet." }, { status: 503 });

  let payload: { reportId?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid report decision." }, { status: 400 });
  }

  const reportId = typeof payload.reportId === "string" ? payload.reportId : "";
  const decision = typeof payload.decision === "string" ? payload.decision : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";
  const decisions: Decision[] = ["reviewed", "rejected", "converted"];
  if (!reportId || !decisions.includes(decision as Decision) || notes.length < 12 || !reviewer) {
    return Response.json({ error: "Choose a decision, add at least 12 characters of evidence, and identify the reviewer." }, { status: 400 });
  }

  const admin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await admin.rpc("apply_community_report_decision", {
    p_report_id: reportId,
    p_decision: decision,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
  });
  if (error) return Response.json({ error: "The community report decision could not be saved." }, { status: 500 });
  return Response.json({ ok: true });
}
