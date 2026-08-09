import { createClient } from "@supabase/supabase-js";
import { snapshotHoldersOfEdition } from "@/lib/portfolioSnapshot";

type Classification = "printing_not_identified" | "known_later_print" | "first_print_proven";

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
    return Response.json({ error: "Print classification actions are not configured yet." }, { status: 503 });
  }

  let payload: { observationId?: unknown; classification?: unknown; proofUrl?: unknown; printingNumber?: unknown; notes?: unknown; reviewer?: unknown };
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a valid print classification decision." }, { status: 400 });
  }

  const classifications: Classification[] = ["printing_not_identified", "known_later_print", "first_print_proven"];
  const observationId = typeof payload.observationId === "string" ? payload.observationId : "";
  const classification = typeof payload.classification === "string" ? payload.classification : "";
  const proofUrl = typeof payload.proofUrl === "string" ? payload.proofUrl.trim() : "";
  const printingNumberRaw = typeof payload.printingNumber === "string" ? payload.printingNumber.trim() : "";
  const printingNumber = printingNumberRaw ? Number(printingNumberRaw) : null;
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  const reviewer = typeof payload.reviewer === "string" ? payload.reviewer.trim() : "";

  if (!observationId || !classifications.includes(classification as Classification) || !reviewer) {
    return Response.json({ error: "Choose a classification and identify the reviewer." }, { status: 400 });
  }
  if (notes.length < 12) {
    return Response.json({ error: "Add an evidence note of at least 12 characters explaining the printing classification." }, { status: 400 });
  }
  if (classification === "first_print_proven" && !proofUrl) {
    return Response.json({ error: "A first-print classification requires a direct printing-proof URL." }, { status: 400 });
  }
  if (printingNumberRaw && (!Number.isFinite(printingNumber) || (printingNumber as number) < 1)) {
    return Response.json({ error: "Known printing number must be a positive number." }, { status: 400 });
  }

  const supabaseAdmin = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: observation } = await supabaseAdmin.from("price_observations").select("edition_id").eq("id", observationId).maybeSingle();

  const { error } = await supabaseAdmin.rpc("apply_price_print_classification", {
    p_observation_id: observationId,
    p_classification: classification,
    p_printing_proof_url: proofUrl || null,
    p_known_printing_number: printingNumber,
    p_decision_notes: notes,
    p_reviewed_by: reviewer,
  });

  if (error) return Response.json({ error: error.message || "The print classification could not be saved." }, { status: 500 });

  // Print classification is as much a valuation input as match_status is
  // (see computeEditionMetrics in lib/portfolioValuation.ts, which only
  // counts first_print_proven sales) -- a classification change can move a
  // sale in or out of a portfolio's evidence set just like a review
  // decision can, so it gets the same immediate re-snapshot.
  if (observation?.edition_id) {
    try {
      await snapshotHoldersOfEdition(supabaseAdmin, observation.edition_id);
    } catch {
      // Best-effort: the classification decision itself already succeeded.
    }
  }

  return Response.json({ ok: true });
}
