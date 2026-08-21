import { runGuardedAgentCycle } from "@/lib/agentCycle";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  try {
    const cycle = await runGuardedAgentCycle(admin, "schedule", "RAR Schedule");
    return Response.json({ ok: cycle.failed === 0, cycle }, { status: cycle.failed ? 207 : 200 });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "The guarded agent cycle failed." }, { status: 500 });
  }
}
