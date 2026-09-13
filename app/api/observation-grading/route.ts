import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { snapshotHoldersOfEdition } from "@/lib/portfolioSnapshot";

// Correcting the grading on an already-verified sale.
//
// A sale whose listing title mentions grading but whose grading columns are
// empty is withheld from raw comparison groups, because a graded slab priced
// like a graded slab would otherwise drag every raw figure for its edition.
// Withholding keeps the charts honest but leaves the sale in limbo; this is
// the workflow that gets it out, and it needs a person who opened the
// original listing. RAR never reads a grade off a title.

export const dynamic = "force-dynamic";

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: {
    observationId?: unknown; copyType?: unknown; gradingCompany?: unknown;
    gradeLabel?: unknown; sourceConfirmed?: unknown; notes?: unknown; reviewer?: unknown;
  };
  try { payload = await request.json(); } catch { return Response.json({ error: "Send a valid grading correction." }, { status: 400 }); }

  const observationId = clean(payload.observationId);
  const copyType = clean(payload.copyType);
  const reviewer = clean(payload.reviewer);
  if (!observationId) return Response.json({ error: "Choose the sale to correct." }, { status: 400 });
  if (!reviewer) return Response.json({ error: "Add your name or initials so the correction is attributable." }, { status: 400 });
  if (!["raw", "graded"].includes(copyType)) return Response.json({ error: "Say whether the copy is raw or graded." }, { status: 400 });
  if (payload.sourceConfirmed !== true) {
    return Response.json({ error: "Confirm that you opened the original listing and saw what the copy actually is." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("record_observation_grading", {
    p_observation_id: observationId,
    p_copy_type: copyType,
    p_grading_company: copyType === "graded" ? clean(payload.gradingCompany) : null,
    p_grade_label: copyType === "graded" ? clean(payload.gradeLabel) : null,
    p_source_confirmed: true,
    p_decision_notes: clean(payload.notes) || null,
    p_reviewed_by: reviewer,
  });

  if (error) {
    const message = error.message ?? "";
    if (/function .*record_observation_grading.* does not exist|schema cache/i.test(message)) {
      return Response.json({ error: "RAR's grading-correction database function is missing. Apply the outstanding migration first; nothing was written." }, { status: 503 });
    }
    return Response.json({ error: message || "The correction could not be saved. Nothing was changed." }, { status: 409 });
  }

  // The sale's comparison group may have changed, so any holding valued from
  // it needs recalculating. A failure here does not undo the correction, which
  // is already committed and audited.
  const { data: observation } = await admin.from("price_observations").select("edition_id").eq("id", observationId).maybeSingle();
  if (observation?.edition_id) {
    try { await snapshotHoldersOfEdition(admin, observation.edition_id); } catch { /* The correction and its audit already succeeded. */ }
  }

  return Response.json(data ?? { ok: true });
}
