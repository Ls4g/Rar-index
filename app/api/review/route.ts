import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { snapshotHoldersOfEdition } from "@/lib/portfolioSnapshot";
import { recordAgentHumanFeedback } from "@/lib/agentHumanFeedback";

type ReviewDecision = "verified_match" | "needs_review" | "excluded";
type PrintClassification = "known_later_print" | "first_print_proven";
type ReviewResult = { observationId: string; ok: boolean; error?: string };

const BULK_CONCURRENCY = 6;

function clean(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

async function applyAll(observationIds: string[], apply: (observationId: string) => Promise<ReviewResult>) {
  const results: ReviewResult[] = [];
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < observationIds.length) results.push(await apply(observationIds[nextIndex++]));
  }
  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, observationIds.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });

  let payload: { observationId?: unknown; observationIds?: unknown; decision?: unknown; notes?: unknown; reviewer?: unknown; printClassification?: unknown; proofUrl?: unknown; printingNumber?: unknown; feedbackReason?: unknown };
  try { payload = await request.json(); } catch { return Response.json({ error: "Send a valid review decision." }, { status: 400 }); }

  const requestedIds = Array.isArray(payload.observationIds)
    ? payload.observationIds.map(clean).filter(Boolean)
    : [clean(payload.observationId)].filter(Boolean);
  const observationIds = [...new Set(requestedIds)];
  const decision = clean(payload.decision) as ReviewDecision;
  const notes = clean(payload.notes);
  const reviewer = clean(payload.reviewer);
  const feedbackReason = clean(payload.feedbackReason);
  const printClassification = clean(payload.printClassification) as PrintClassification | "";
  const proofUrl = clean(payload.proofUrl);
  const printingNumberRaw = clean(payload.printingNumber);
  const printingNumber = printingNumberRaw ? Number(printingNumberRaw) : null;

  if (!observationIds.length || !(["verified_match", "needs_review", "excluded"] as string[]).includes(decision) || !reviewer) {
    return Response.json({ error: "Choose at least one sale, a decision, and identify the reviewer." }, { status: 400 });
  }
  if (printClassification && decision !== "verified_match") return Response.json({ error: "Printing can only be classified while verifying an exact edition match." }, { status: 400 });
  if (printClassification && !(["known_later_print", "first_print_proven"] as string[]).includes(printClassification)) return Response.json({ error: "Choose a recognised print classification." }, { status: 400 });
  if (printClassification && observationIds.length !== 1) return Response.json({ error: "Printing proof belongs to one sold copy and cannot be applied in bulk." }, { status: 400 });
  if (printClassification === "first_print_proven" && !proofUrl) return Response.json({ error: "A first-print decision requires the direct copyright-page proof URL." }, { status: 400 });
  if (printingNumberRaw && (!Number.isFinite(printingNumber) || (printingNumber as number) < 1)) return Response.json({ error: "Known printing number must be a positive number." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: observations, error: observationError } = await admin.from("price_observations")
    .select("id,edition_id,match_status")
    .in("id", observationIds);
  if (observationError) return Response.json({ error: "RAR could not load the selected sales." }, { status: 500 });

  const rowsById = new Map((observations ?? []).map((row) => [row.id as string, row]));
  const eligibleIds = observationIds.filter((id) => rowsById.get(id)?.match_status === "needs_review");
  const protectedResults: ReviewResult[] = observationIds
    .filter((id) => rowsById.get(id)?.match_status !== "needs_review")
    .map((observationId) => ({ observationId, ok: false, error: "This sale has already received an edition-match decision." }));

  const results = [
    ...protectedResults,
    ...await applyAll(eligibleIds, async (observationId) => {
      try {
        // When direct printing proof is already on the card, the reviewer can
        // finish both audits in one action. Classify first so a failed proof
        // check cannot accidentally publish a half-completed sale.
        if (printClassification) {
          const { error: classificationError } = await admin.rpc("apply_price_print_classification", {
            p_observation_id: observationId,
            p_classification: printClassification,
            p_printing_proof_url: proofUrl || null,
            p_known_printing_number: printingNumber,
            p_decision_notes: notes,
            p_reviewed_by: reviewer,
          });
          if (classificationError) return { observationId, ok: false, error: classificationError.message };
        }
        const { error } = await admin.rpc("apply_price_review", {
          p_observation_id: observationId,
          p_decision: decision,
          p_decision_notes: notes,
          p_reviewed_by: reviewer,
        });
        return { observationId, ok: !error, error: error?.message };
      } catch {
        return { observationId, ok: false, error: "The database did not accept this review decision." };
      }
    }),
  ];

  const saved = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const affectedEditions = [...new Set(saved.map((result) => rowsById.get(result.observationId)?.edition_id as string | undefined).filter((id): id is string => Boolean(id)))];
  await Promise.all(affectedEditions.map(async (editionId) => {
    try { await snapshotHoldersOfEdition(admin, editionId); } catch { /* The review decision itself already succeeded. */ }
  }));
  await recordAgentHumanFeedback(admin, {
    workflow: "sale",
    subjectKeys: saved.map((result) => `sale:${result.observationId}`),
    outcome: decision,
    reasonLabel: feedbackReason,
    note: notes,
    reviewedBy: reviewer,
  });

  if (!saved.length) return Response.json({ error: failed[0]?.error ?? "The review decision could not be saved.", saved: [], failed }, { status: 500 });
  return Response.json({
    ok: true,
    saved: saved.map((result) => result.observationId),
    failed: failed.map((result) => ({ observationId: result.observationId, error: result.error })),
  });
}
