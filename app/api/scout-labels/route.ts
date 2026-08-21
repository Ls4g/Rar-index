import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { isScoutLearningLabel } from "@/lib/scoutDecisionLabels";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: { decisionId?: unknown; decisionIds?: unknown; label?: unknown; reviewer?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid historical Scout label." }, { status: 400 });
  }

  const requested = Array.isArray(payload.decisionIds) ? payload.decisionIds : [payload.decisionId];
  const decisionIds = [...new Set(requested.map(clean).filter(Boolean))].slice(0, 50);
  const label = clean(payload.label);
  const reviewer = clean(payload.reviewer);
  if (!decisionIds.length || !reviewer || !isScoutLearningLabel(label)) {
    return Response.json({ error: "Choose one or more decisions, a valid reason and a staff name." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const results = [];
  for (const decisionId of decisionIds) {
    const { error } = await admin.rpc("apply_historical_scout_label", {
      p_decision_id: decisionId,
      p_label: label,
      p_created_by: reviewer,
    });
    results.push({ decisionId, ok: !error, error: error?.message });
  }
  const failed = results.filter((item) => !item.ok);
  if (failed.length === results.length) return Response.json({ error: failed[0]?.error ?? "Labels could not be saved.", results }, { status: 409 });
  return Response.json({ ok: failed.length === 0, saved: results.length - failed.length, failed: failed.length, results });
}
