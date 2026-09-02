import { runChangedReliabilitySuites } from "@/lib/agentReliability";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Cron authorization failed." }, { status: 401 });
  }
  try {
    const result = await runChangedReliabilitySuites(getSupabaseAdmin(), "RAR Reliability Schedule", "schedule");
    return Response.json({ ok: true, result });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "The scheduled reliability check failed." }, { status: 500 });
  }
}
