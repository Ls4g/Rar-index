import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type CatalogueDecision = "approve_new" | "link_existing" | "needs_review" | "rejected" | "duplicate";
type ApprovedMetadata = {
  title?: unknown;
  series?: unknown;
  volumeNumber?: unknown;
  author?: unknown;
  publisher?: unknown;
  language?: unknown;
  isbn13?: unknown;
  releaseDate?: unknown;
  printingOfEditionId?: unknown;
};

function cleanMetadata(value: unknown) {
  const input = value && typeof value === "object" ? value as ApprovedMetadata : {};
  const text = (field: unknown) => typeof field === "string" ? field.trim() || null : null;
  return {
    title: text(input.title),
    series: text(input.series),
    volume_number: text(input.volumeNumber),
    author: text(input.author),
    publisher: text(input.publisher),
    language: text(input.language),
    isbn_13: text(input.isbn13)?.replace(/[^0-9Xx]/g, "").toUpperCase() ?? null,
    release_date: text(input.releaseDate),
    printing_of_edition_id: text(input.printingOfEditionId),
  };
}

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

  let payload: { catalogueImportId?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown; existingEditionId?: unknown; metadata?: unknown };
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
  const metadata = cleanMetadata(payload.metadata);

  if (!catalogueImportId || !decisions.includes(decision as CatalogueDecision) || notes.length < 12 || !reviewer) {
    return Response.json({ error: "Choose a decision, add at least 12 characters of evidence, and identify the reviewer." }, { status: 400 });
  }
  if (decision === "link_existing" && !existingEditionId) {
    return Response.json({ error: "Linking requires the exact existing edition ID." }, { status: 400 });
  }
  if (decision === "approve_new" && (!metadata.title || !metadata.language || (metadata.isbn_13 && !/^97[89]\d{10}$/.test(metadata.isbn_13)))) {
    return Response.json({ error: "Approval needs a clean title, language, and a valid ISBN-13 when one is supplied." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc("apply_catalogue_review", {
    p_catalogue_import_id: catalogueImportId,
    p_decision: decision,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
    p_existing_edition_id: existingEditionId,
    p_metadata: decision === "approve_new" ? metadata : null,
  });
  if (error) {
    const message = error.message?.startsWith("ISBN ") || error.message?.startsWith("The selected general edition")
      ? error.message
      : "The catalogue decision could not be saved. Check the edition evidence and try again.";
    return Response.json({ error: message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
