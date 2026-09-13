import { runChangedReliabilitySuites } from "@/lib/agentReliability";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }
  try {
    const admin = getSupabaseAdmin();
    // Return work whose worker never reported back. An expired lease becomes a
    // failed run with the reason attached, never a completed one -- RAR does
    // not know whether the work finished, and saying so is the whole point.
    // Recovered actions keep their approval, so they are retryable rather than
    // needing a human to approve the same thing twice.
    let recovered: unknown = null;
    const recovery = await admin.rpc("recover_expired_agent_action_leases");
    if (recovery.error) {
      // A missing function means the migration is not applied yet. The
      // reliability suites are the job here and must still run.
      if (!/does not exist|schema cache/i.test(recovery.error.message ?? "")) throw new Error(recovery.error.message);
    } else {
      recovered = recovery.data;
    }
    const result = await runChangedReliabilitySuites(admin, "RAR Reliability Schedule", "schedule");
    return Response.json({ ok: true, recovered, result });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "The scheduled reliability check failed." }, { status: 500 });
  }
}
