import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createPortfolioSnapshot } from "@/lib/portfolioSnapshot";
import { DISPLAY_CURRENCIES, type DisplayCurrency } from "@/lib/fx";

// Authenticated-user-safe snapshot creation: the caller sends their own
// Supabase Auth access token (from supabase.auth.getSession() client-side),
// which is verified here with the service-role key before anything is
// read or written -- a user can only ever trigger a snapshot of their own
// portfolio, never anyone else's, and the row is written by the server, not
// trusted from client-supplied numbers.
//
// No scheduling exists yet. This route is the manual/on-demand path only
// (e.g. a user opening the Performance tab, or an explicit refresh). Real
// unattended daily history needs a scheduled job (e.g. Vercel Cron) that
// iterates every user_id with at least one holding and calls
// createPortfolioSnapshot() for each -- intentionally not built here.
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return Response.json({ error: "Sign in required." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return Response.json({ error: "Sign in required." }, { status: 401 });

  let payload: { displayCurrency?: unknown };
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const requested = typeof payload.displayCurrency === "string" ? payload.displayCurrency : "GBP";
  const displayCurrency: DisplayCurrency = (DISPLAY_CURRENCIES as readonly string[]).includes(requested) ? (requested as DisplayCurrency) : "GBP";

  try {
    const snapshot = await createPortfolioSnapshot(admin, userData.user.id, displayCurrency);
    return Response.json({ snapshot }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not create snapshot." }, { status: 500 });
  }
}
