import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

// A reviewer working a screenful of candidates side by side is still deciding
// each one -- comparing several against their catalogue records at once is
// what makes a mismatch obvious. Each id below gets its own call to the same
// function a single decision uses, so each lands its own audit row, and the
// "already has a human decision" guard inside it still holds per candidate.
const MAX_BULK_CANDIDATES = 40;

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await work(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: {
    candidateId?: unknown;
    candidateIds?: unknown;
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
  const candidateIds = Array.isArray(payload.candidateIds)
    ? [...new Set(payload.candidateIds.map(clean).filter(Boolean))]
    : [];
  const decision = clean(payload.decision);
  const coverImageUrl = clean(payload.coverImageUrl);
  const coverSourceUrl = clean(payload.coverSourceUrl);
  const coverSourceName = clean(payload.coverSourceName);
  const reviewer = clean(payload.reviewer);
  const notes = clean(payload.notes);

  if (!reviewer) {
    return Response.json({ error: "Reviewer is required." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  // Bulk path: many candidates, one decision, no edition id -- each candidate
  // already knows the edition it belongs to.
  if (candidateIds.length) {
    if (!["verified", "rejected"].includes(decision)) {
      return Response.json({ error: "A discovered candidate can be verified or rejected." }, { status: 400 });
    }
    if (candidateIds.length > MAX_BULK_CANDIDATES) {
      return Response.json({ error: `Decide at most ${MAX_BULK_CANDIDATES} candidates at a time.` }, { status: 400 });
    }
    const outcomes = await mapWithConcurrency(candidateIds, 5, async (id) => {
      const { error } = await admin.rpc("apply_cover_candidate_decision", {
        p_candidate_id: id,
        p_decision: decision,
        p_decision_notes: notes,
        p_reviewed_by: reviewer,
      });
      return { id, error: error?.message ?? null };
    });
    const failures = outcomes.filter((outcome) => outcome.error);
    return Response.json({
      ok: failures.length === 0,
      saved: outcomes.length - failures.length,
      failed: failures.map((failure) => ({ id: failure.id, error: failure.error })),
    }, { status: failures.length && failures.length === outcomes.length ? 500 : 200 });
  }

  if (!editionId || !["candidate", "verified", "rejected"].includes(decision)) {
    return Response.json({ error: "Choose candidate, verified, or rejected for one exact edition." }, { status: 400 });
  }
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
