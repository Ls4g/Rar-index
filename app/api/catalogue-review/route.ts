import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CatalogueDecision = "approve_new" | "link_existing" | "needs_review" | "rejected" | "duplicate";

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

  let payload: { catalogueImportId?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown; existingEditionId?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid catalogue decision." }, { status: 400 });
  }

  const decisions: CatalogueDecision[] = ["approve_new", "link_existing", "needs_review", "rejected", "duplicate"];
  const catalogueImportId = typeof payload.catalogueImportId === "string" ? payload.catalogueImportId : "";
  const decision = typeof payload.decision === "string" ? payload.decision : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";
  const existingEditionId = typeof payload.existingEditionId === "string" && payload.existingEditionId.trim() ? payload.existingEditionId.trim() : null;

  if (!catalogueImportId || !decisions.includes(decision as CatalogueDecision) || notes.length < 12 || !reviewer) {
    return Response.json({ error: "Choose a decision, add at least 12 characters of evidence, and identify the reviewer." }, { status: 400 });
  }
  if (decision === "link_existing" && !existingEditionId) {
    return Response.json({ error: "Linking requires the exact existing edition ID." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc("apply_catalogue_review", {
    p_catalogue_import_id: catalogueImportId,
    p_decision: decision,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
    p_existing_edition_id: existingEditionId,
  });
  if (error) return Response.json({ error: "The catalogue decision could not be saved. Check the edition evidence and try again." }, { status: 500 });
  return Response.json({ ok: true });
}
