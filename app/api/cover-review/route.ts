import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: {
    candidateId?: unknown;
    editionId?: unknown;
    decision?: unknown;
    coverImageUrl?: unknown;
    coverSourceUrl?: unknown;
    coverSourceName?: unknown;
    reviewer?: unknown;
    notes?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid cover review decision." }, { status: 400 });
  }

  const editionId = clean(payload.editionId);
  const candidateId = clean(payload.candidateId);
  const decision = clean(payload.decision);
  const coverImageUrl = clean(payload.coverImageUrl);
  const coverSourceUrl = clean(payload.coverSourceUrl);
  const coverSourceName = clean(payload.coverSourceName);
  const reviewer = clean(payload.reviewer);
  const notes = clean(payload.notes);

  if (!editionId || !["candidate", "verified", "rejected"].includes(decision)) {
    return Response.json({ error: "Choose candidate, verified, or rejected for one exact edition." }, { status: 400 });
  }
  if (!reviewer) {
    return Response.json({ error: "Reviewer is required." }, { status: 400 });
  }
  if (notes.length < 12) {
    return Response.json({ error: "Add a review note of at least 12 characters." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  if (candidateId) {
    if (!["verified", "rejected"].includes(decision)) {
      return Response.json({ error: "A discovered candidate can be verified or rejected." }, { status: 400 });
    }
    const { data: candidate, error: candidateError } = await admin
      .from("cover_candidates")
      .select("edition_id")
      .eq("id", candidateId)
      .maybeSingle();
    if (candidateError || !candidate || candidate.edition_id !== editionId) {
      return Response.json({ error: "This candidate does not belong to the selected edition." }, { status: 400 });
    }
    const { error } = await admin.rpc("apply_cover_candidate_decision", {
      p_candidate_id: candidateId,
      p_decision: decision,
      p_decision_notes: notes,
      p_reviewed_by: reviewer,
    });
    if (error) return Response.json({ error: error.message || "The cover candidate decision could not be saved." }, { status: 500 });
    return Response.json({ ok: true });
  }

  if (decision === "verified" && (!coverImageUrl || !coverSourceUrl || !coverSourceName)) {
    return Response.json({ error: "A verified cover requires an image URL, a source record URL, and a source name." }, { status: 400 });
  }
  if (decision === "candidate" && !coverImageUrl && !coverSourceUrl) {
    return Response.json({ error: "A candidate cover needs at least an image URL or a source record URL." }, { status: 400 });
  }

  const { error } = await admin.rpc("apply_cover_review", {
    p_edition_id: editionId,
    p_decision: decision,
    p_cover_image_url: coverImageUrl || null,
    p_cover_source_url: coverSourceUrl || null,
    p_cover_source_name: coverSourceName || null,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
  });
  if (error) return Response.json({ error: error.message || "The cover review decision could not be saved." }, { status: 500 });
  return Response.json({ ok: true });
}
