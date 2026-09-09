import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { captureWatchedListings, promoteEndedListings, runOutcomeChecks } from "@/lib/watchToSale";

// Watch-to-Sale, unattended. Runs after the daily Scout scan so it captures
// what that scan just found, then checks whatever has since ended.
//
// It can create a sold CANDIDATE and nothing more. No sale, no verification,
// no chart. The only path from here to evidence is a human pressing confirm
// on /listing-outcomes.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Secrets in query strings leak into browser history, proxy logs and
  // analytics. Vercel Cron sends CRON_SECRET as a Bearer token, matching the
  // other scheduled routes in this app, so this endpoint is header-only.
  const authorised = request.headers.get("authorization") === `Bearer ${secret}`;
  if (!secret || !authorised) return Response.json({ error: "Unauthorised." }, { status: 401 });

  const admin = getSupabaseAdmin();
  try {
    const captured = await captureWatchedListings(admin);
    const promoted = await promoteEndedListings(admin);
    const checks = await runOutcomeChecks(admin);
    return Response.json({ ok: true, captured, promoted, checks });
  } catch (error) {
    // Reported as a failed run rather than thrown, so a broken outcome check
    // never takes Market Scout's own cron down with it.
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Outcome checks failed." }, { status: 500 });
  }
}
