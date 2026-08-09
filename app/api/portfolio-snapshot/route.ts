import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createPortfolioSnapshot, DEFAULT_SNAPSHOT_CURRENCY, type SnapshotTriggerReason } from "@/lib/portfolioSnapshot";

// Authenticated-user-safe snapshot creation: the caller sends their own
// Supabase Auth access token (from supabase.auth.getSession() client-side),
// which is verified here with the service-role key before anything is
// read or written -- a user can only ever trigger a snapshot of their own
// portfolio, never anyone else's, and the row is written by the server, not
// trusted from client-supplied numbers.
//
// This is the automatic, background path fired by components/PortfolioClient
// right after a holding is added, edited, or removed -- there is no
// user-facing button anymore. Only reasons a holding-CRUD action can
// legitimately claim are accepted here; evidence-change and daily-cron
// snapshots are recorded server-side directly (see lib/portfolioSnapshot.ts
// and app/api/cron/portfolio-snapshots/route.ts), never through this route.
const CLIENT_TRIGGERABLE_REASONS: SnapshotTriggerReason[] = ["holding_added", "holding_updated", "holding_removed"];

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return Response.json({ error: "Sign in required." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sign in required." }, { status: 401 });

  let payload: { reason?: unknown };
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const requestedReason = typeof payload.reason === "string" ? payload.reason : "";
  const reason = (CLIENT_TRIGGERABLE_REASONS as string[]).includes(requestedReason) ? (requestedReason as SnapshotTriggerReason) : null;

  try {
    const { snapshot, created } = await createPortfolioSnapshot(admin, userData.user.id, DEFAULT_SNAPSHOT_CURRENCY, reason);
    return Response.json({ snapshot, created }, { status: created ? 201 : 200 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create snapshot." }, { status: 500 });
  }
}
