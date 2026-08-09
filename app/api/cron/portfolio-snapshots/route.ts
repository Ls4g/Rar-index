import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { createPortfolioSnapshot, DEFAULT_SNAPSHOT_CURRENCY } from "@/lib/portfolioSnapshot";

export const maxDuration = 60;

function isAuthorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

// The daily-history foundation described in
// supabase/migrations/20260810_portfolio_snapshots.sql's own comments: one
// snapshot per user with at least one holding, once a day, regardless of
// whether anything changed for them today (the dedup check inside
// createPortfolioSnapshot still applies, so an unchanged portfolio does not
// grow a duplicate row -- this just guarantees every user gets *checked*
// daily, not that every user gets a new row daily).
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return Response.json({ error: "Unauthorized cron request." }, { status: 401 });

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("portfolio_holdings").select("user_id");
  if (error) return Response.json({ error: "Could not load portfolio holders." }, { status: 500 });

  const userIds = [...new Set((data ?? []).map((row) => row.user_id as string))];
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const userId of userIds) {
    try {
      const result = await createPortfolioSnapshot(admin, userId, DEFAULT_SNAPSHOT_CURRENCY, "daily_cron");
      if (result.created) created += 1; else skipped += 1;
    } catch {
      failed += 1;
    }
  }

  return Response.json({ usersChecked: userIds.length, created, skipped, failed });
}
