import { AGENT_KEYS } from "@/lib/agentPlanning";
import { runAgentObservation } from "@/lib/agentRuntime";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const results = [];
  for (const agentKey of AGENT_KEYS) {
    try {
      const run = await runAgentObservation(admin, agentKey, "schedule", "RAR Schedule");
      results.push({ agentKey, ok: true, run });
    } catch (caught) {
      results.push({ agentKey, ok: false, error: caught instanceof Error ? caught.message : "Unknown agent error" });
    }
  }
  const failed = results.some((result) => !result.ok);
  return Response.json({ ok: !failed, results }, { status: failed ? 207 : 200 });
}
