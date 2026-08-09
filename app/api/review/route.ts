import { createClient } from "@supabase/supabase-js";
import { snapshotHoldersOfEdition } from "@/lib/portfolioSnapshot";

type ReviewDecision = "verified_match" | "needs_review" | "excluded";

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
  if (!isStaffRequest(request)) {
    return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return Response.json({ error: "Review actions are not configured yet." }, { status: 503 });
  }

  let payload: { observationId?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid review decision." }, { status: 400 });
  }

  const decisions: ReviewDecision[] = ["verified_match", "needs_review", "excluded"];
  const observationId = typeof payload.observationId === "string" ? payload.observationId : "";
  const decision = typeof payload.decision === "string" ? payload.decision : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";
  if (!observationId || !decisions.includes(decision as ReviewDecision) || !reviewer) {
    return Response.json({ error: "Choose a decision and identify the reviewer." }, { status: 400 });
  }

  const supabaseAdmin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: observation } = await supabaseAdmin.from("price_observations").select("edition_id").eq("id", observationId).maybeSingle();

  const { error } = await supabaseAdmin.rpc("apply_price_review", {
    p_observation_id: observationId,
    p_decision: decision,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
  });

  if (error) return Response.json({ error: "The review decision could not be saved." }, { status: 500 });

  // A review decision changes what counts as verified evidence for this
  // edition's whole publication family -- every affected portfolio should
  // reflect that today, not after tomorrow's cron. Runs as the affected
  // users via the service-role client (RLS is bypassed, not routed around),
  // and never fails the staff member's own successful review decision.
  if (observation?.edition_id) {
    try {
      await snapshotHoldersOfEdition(supabaseAdmin, observation.edition_id);
    } catch {
      // Best-effort: the review decision itself already succeeded.
    }
  }

  return Response.json({ ok: true });
}
