import { isStaffRequest } from "@/lib/staffSession";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff sign-in required." }, { status: 401 });
  let payload: { reportId?: unknown; decision?: unknown };
  try { payload = await request.json(); }
  catch { return Response.json({ error: "Invalid report decision." }, { status: 400 }); }
  const reportId = typeof payload.reportId === "string" ? payload.reportId : "";
  const decision = payload.decision;
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || (decision !== "hide" && decision !== "dismiss"))
    return Response.json({ error: "Choose a valid report and decision." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: report, error: readError } = await admin.from("collector_gallery_comment_reports")
    .select("id,comment_id,status").eq("id", reportId).maybeSingle();
  if (readError || !report || report.status !== "open") return Response.json({ error: "Open report not found." }, { status: 404 });
  if (decision === "hide") {
    const { error } = await admin.from("collector_gallery_comments").update({ is_hidden: true }).eq("id", report.comment_id);
    if (error) return Response.json({ error: "Could not hide the comment." }, { status: 500 });
  }
  const { error } = await admin.from("collector_gallery_comment_reports")
    .update({ status: decision === "hide" ? "hidden" : "dismissed", reviewed_at: new Date().toISOString() })
    .eq("id", reportId).eq("status", "open");
  if (error) return Response.json({ error: "Could not save the decision." }, { status: 500 });
  return Response.json({ ok: true });
}
