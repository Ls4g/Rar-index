import { runRecordedCron } from "@/lib/cronHeartbeat";
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
  const authorised = request.headers.get("authorization") === `Bearer ${secret}`
    || new URL(request.url).searchParams.get("secret") === secret;
  if (!secret || !authorised) return Response.json({ error: "Unauthorised." }, { status: 401 });

  return runRecordedCron("listing-outcomes", getSupabaseAdmin, async (admin) => {
    try {
      const captured = await captureWatchedListings(admin);
      const promoted = await promoteEndedListings(admin);
      const checks = await runOutcomeChecks(admin);
      const ok = !checks.budgetUnavailable && checks.errors.length === 0;
      return Response.json({ ok, captured, promoted, checks }, { status: checks.budgetUnavailable ? 503 : ok ? 200 : 207 });
    } catch (error) {
      // Reported as a failed run rather than thrown, so a broken outcome check
      // never takes Market Scout's own cron down with it.
      return Response.json({ ok: false, error: error instanceof Error ? error.message : "Outcome checks failed." }, { status: 500 });
    }
  });
}
