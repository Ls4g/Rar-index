import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { catalogueMetadataProblem, queuedReviewMetadata } from "@/lib/catalogueReviewMetadata";

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

const MAX_BULK_RECORDS = 40;

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
  if (!isStaffRequest(request)) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { catalogueImportId?: unknown; catalogueImportIds?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown; existingEditionId?: unknown; metadata?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid catalogue decision." }, { status: 400 });
  }

  const decisions: CatalogueDecision[] = ["approve_new", "link_existing", "needs_review", "rejected", "duplicate"];
  const catalogueImportId = typeof payload.catalogueImportId === "string" ? payload.catalogueImportId : "";
  const catalogueImportIds = Array.isArray(payload.catalogueImportIds)
    ? [...new Set(payload.catalogueImportIds.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [];
  const decision = typeof payload.decision === "string" ? payload.decision : "";
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";
  const existingEditionId = typeof payload.existingEditionId === "string" && payload.existingEditionId.trim() ? payload.existingEditionId.trim() : null;
  const metadata = cleanMetadata(payload.metadata);

  if (!reviewer) {
    return Response.json({ error: "Identify the reviewer." }, { status: 400 });
  }

  // Bulk path. Deliberately excludes link_existing, which needs a different
  // existing edition named per row and so cannot be one decision applied to
  // many. Ordinary book fields come from each candidate row. Source-owned
  // identity fields are loaded again on the server and sent to the RPC, so a
  // magazine cannot lose its year/issue identity during bulk approval.
  if (catalogueImportIds.length) {
    if (!decisions.includes(decision as CatalogueDecision) || decision === "link_existing") {
      return Response.json({ error: "Bulk decisions can approve, reject, mark duplicate, or send back for review — linking needs one exact edition per record." }, { status: 400 });
    }
    if (catalogueImportIds.length > MAX_BULK_RECORDS) {
      return Response.json({ error: `Decide at most ${MAX_BULK_RECORDS} records at a time.` }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    const { data: queuedRows, error: queueError } = await admin
      .from("catalogue_import_queue")
      .select("id,raw_payload")
      .in("id", catalogueImportIds);
    if (queueError) return Response.json({ error: "RAR could not load the selected catalogue candidates." }, { status: 500 });
    const queuedById = new Map((queuedRows ?? []).map((row) => [row.id as string, row.raw_payload]));
    const outcomes = await mapWithConcurrency(catalogueImportIds, 4, async (id) => {
      if (!queuedById.has(id)) return { id, error: "This catalogue candidate no longer exists." };
      const sourceMetadata = queuedReviewMetadata(queuedById.get(id));
      const metadataProblem = decision === "approve_new" ? catalogueMetadataProblem(sourceMetadata) : null;
      if (metadataProblem) return { id, error: metadataProblem };
      const { error } = await admin.rpc("apply_catalogue_review", {
        p_catalogue_import_id: id,
        p_decision: decision,
        p_decision_notes: notes,
        p_reviewed_by: reviewer,
        p_existing_edition_id: null,
        p_metadata: decision === "approve_new" ? sourceMetadata : null,
      });
      return { id, error: error?.message ?? null };
    });
    const failed = outcomes.filter((outcome) => outcome.error);
    return Response.json({
      ok: failed.length === 0,
      saved: outcomes.length - failed.length,
      failed: failed.map((outcome) => ({ id: outcome.id, error: outcome.error })),
    });
  }

  if (!catalogueImportId || !decisions.includes(decision as CatalogueDecision)) {
    return Response.json({ error: "Choose a decision for one exact record." }, { status: 400 });
  }
  if (decision === "link_existing" && !existingEditionId) {
    return Response.json({ error: "Linking requires the exact existing edition ID." }, { status: 400 });
  }
  if (decision === "approve_new" && (!metadata.title || !metadata.language || (metadata.isbn_13 && !/^97[89]\d{10}$/.test(metadata.isbn_13)))) {
    return Response.json({ error: "Approval needs a clean title, language, and a valid ISBN-13 when one is supplied." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: queuedRow, error: queueError } = await admin
    .from("catalogue_import_queue")
    .select("raw_payload")
    .eq("id", catalogueImportId)
    .maybeSingle();
  if (queueError || !queuedRow) return Response.json({ error: "This catalogue candidate no longer exists." }, { status: 404 });
  const sourceMetadata = queuedReviewMetadata(queuedRow.raw_payload);
  const metadataProblem = decision === "approve_new" ? catalogueMetadataProblem(sourceMetadata) : null;
  if (metadataProblem) return Response.json({ error: metadataProblem }, { status: 400 });
  const { error } = await admin.rpc("apply_catalogue_review", {
    p_catalogue_import_id: catalogueImportId,
    p_decision: decision,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
    p_existing_edition_id: existingEditionId,
    p_metadata: decision === "approve_new" ? { ...metadata, ...sourceMetadata } : null,
  });
  if (error) {
    const message = error.message?.startsWith("ISBN ") || error.message?.startsWith("The selected general edition")
      ? error.message
      : "The catalogue decision could not be saved. Check the edition evidence and try again.";
    return Response.json({ error: message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
