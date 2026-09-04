import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { snapshotHoldersOfEdition } from "@/lib/portfolioSnapshot";
import { recordAgentHumanFeedback } from "@/lib/agentHumanFeedback";
import { isStaffRequest } from "@/lib/staffSession";

type Classification = "printing_not_identified" | "known_later_print" | "first_print_proven";

const BULK_CONCURRENCY = 6;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

type ClassificationResult = { observationId: string; ok: boolean; error?: string };

// A reviewer can select a whole screen of sales at once. Firing every RPC
// call at the same instant is unreliable on a serverless request, so the
// work stays bounded while still producing an individual result — and an
// individual audit row — for every observation.
async function applyAll(
  observationIds: string[],
  apply: (observationId: string) => Promise<ClassificationResult>,
) {
  const results: ClassificationResult[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < observationIds.length) {
      const observationId = observationIds[nextIndex++];
      results.push(await apply(observationId));
    }
  }

  await Promise.all(Array.from({ length: Math.min(BULK_CONCURRENCY, observationIds.length) }, worker));
  return results;
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) {
    return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return Response.json({ error: "Print classification actions are not configured yet." }, { status: 503 });
  }

  let payload: { observationId?: unknown; observationIds?: unknown; classification?: unknown; proofUrl?: unknown; printingNumber?: unknown; notes?: unknown; reviewer?: unknown; suggestionActionId?: unknown; feedbackReason?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid print classification decision." }, { status: 400 });
  }

  const classifications: Classification[] = ["printing_not_identified", "known_later_print", "first_print_proven"];
  // Accepts one observation (unchanged single-decision shape) or many, for
  // the queue's bulk action. Both paths run the same RPC once per sale, so
  // every decision keeps its own auditable row and identical validation.
  const requestedIds = Array.isArray(payload.observationIds)
    ? payload.observationIds.map(clean).filter(Boolean)
    : [clean(payload.observationId)].filter(Boolean);
  const observationIds = [...new Set(requestedIds)];
  const classification = clean(payload.classification);
  const proofUrl = clean(payload.proofUrl);
  const printingNumberRaw = clean(payload.printingNumber);
  const printingNumber = printingNumberRaw ? Number(printingNumberRaw) : null;
  const notes = clean(payload.notes);
  const reviewer = clean(payload.reviewer);
  const suggestionActionId = clean(payload.suggestionActionId);
  const feedbackReason = clean(payload.feedbackReason);

  if (!observationIds.length || !classifications.includes(classification as Classification)) {
    return Response.json({ error: "Choose a classification for at least one sale." }, { status: 400 });
  }
  if (!reviewer) {
    return Response.json({ error: "Add your name or initials as the reviewer before saving." }, { status: 400 });
  }
  if (classification === "first_print_proven" && !proofUrl) {
    return Response.json({ error: "A first-print classification requires a direct printing-proof URL." }, { status: 400 });
  }
  // Proof is tied to one exact sold copy, so it can never be applied across
  // a selection: one URL cannot evidence the printing of several different
  // copies. First-print claims stay a one-at-a-time decision by design.
  if (classification === "first_print_proven" && observationIds.length > 1) {
    return Response.json({ error: "First-print proof belongs to one exact copy — classify these individually, each with its own proof URL." }, { status: 400 });
  }
  if (printingNumberRaw && (!Number.isFinite(printingNumber) || (printingNumber as number) < 1)) {
    return Response.json({ error: "Known printing number must be a positive number." }, { status: 400 });
  }

  const supabaseAdmin: SupabaseClient = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: observations } = await supabaseAdmin
    .from("price_observations")
    .select("id,edition_id")
    .in("id", observationIds);
  const editionByObservation = new Map((observations ?? []).map((row) => [row.id as string, row.edition_id as string]));

  const results = await applyAll(observationIds, async (observationId) => {
    const { error } = await supabaseAdmin.rpc("apply_price_print_classification", {
      p_observation_id: observationId,
      p_classification: classification,
      p_printing_proof_url: proofUrl || null,
      p_known_printing_number: printingNumber,
      p_decision_notes: notes,
      p_reviewed_by: reviewer,
    });
    return { observationId, ok: !error, error: error?.message };
  });

  const saved = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);

  // Print classification is as much a valuation input as match_status is
  // (see computeEditionMetrics in lib/portfolioValuation.ts) -- a change can
  // move a sale in or out of a portfolio's evidence set, so affected holders
  // get the same immediate re-snapshot a review decision triggers.
  const affectedEditions = [...new Set(saved.map((result) => editionByObservation.get(result.observationId)).filter((id): id is string => Boolean(id)))];

  // Resolving a row also closes any open Evidence Auditor suggestion for it.
  // The human print decision above remains the authoritative audit record;
  // this status update only records that the prepared task was handled.
  if (saved.length) {
    const savedIds = saved.map((result) => result.observationId);
    let suggestionUpdate = supabaseAdmin.from("agent_actions").update({
      status: "executed",
      reviewed_by: reviewer,
      review_notes: `Staff resolved the prepared printing suggestion as ${classification}.`,
      reviewed_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
    })
      .eq("agent_key", "evidence_auditor")
      .eq("action_type", "suggest_print_classification")
      .eq("status", "proposed")
      .in("target_id", savedIds);
    if (suggestionActionId && savedIds.length === 1) suggestionUpdate = suggestionUpdate.eq("id", suggestionActionId);
    await suggestionUpdate;
  }
  await Promise.all(affectedEditions.map(async (editionId) => {
    try {
      await snapshotHoldersOfEdition(supabaseAdmin, editionId);
    } catch {
      // Best-effort: the classification decisions themselves already succeeded.
    }
  }));
  await recordAgentHumanFeedback(supabaseAdmin, {
    workflow: "printing",
    subjectKeys: saved.map((result) => `printing:${result.observationId}`),
    outcome: classification,
    reasonLabel: feedbackReason,
    note: notes,
    reviewedBy: reviewer,
  });

  if (!saved.length) {
    return Response.json({ error: failed[0]?.error ?? "The print classification could not be saved." }, { status: 500 });
  }

  return Response.json({
    ok: true,
    saved: saved.map((result) => result.observationId),
    failed: failed.map((result) => ({ observationId: result.observationId, error: result.error })),
  });
}
