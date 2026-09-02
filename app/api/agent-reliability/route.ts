import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import {
  isReliabilityEvaluatorKey,
  runChangedReliabilitySuites,
  runReliabilitySuite,
  syncReliabilityBenchmarks,
} from "@/lib/agentReliability";

export const maxDuration = 60;

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  if (!(await isStaffRequest(request))) return Response.json({ error: "Staff credentials are required." }, { status: 401 });
  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "A valid reliability command is required." }, { status: 400 });
  }
  const reviewer = clean(payload.reviewer);
  if (!reviewer) return Response.json({ error: "Enter your staff name before running reliability checks." }, { status: 400 });
  const admin = getSupabaseAdmin();

  try {
    if (payload.command === "sync_benchmarks") {
      return Response.json({ ok: true, sync: await syncReliabilityBenchmarks(admin) });
    }
    if (payload.command === "run_suite") {
      if (!isReliabilityEvaluatorKey(payload.evaluatorKey)) return Response.json({ error: "Choose a valid reliability suite." }, { status: 400 });
      await syncReliabilityBenchmarks(admin);
      return Response.json({ ok: true, run: await runReliabilitySuite(admin, payload.evaluatorKey, reviewer, "manual") });
    }
    if (payload.command === "run_changed_suites") {
      return Response.json({ ok: true, result: await runChangedReliabilitySuites(admin, reviewer, "manual") });
    }
    return Response.json({ error: "Unknown reliability command." }, { status: 400 });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "The reliability check failed." }, { status: 500 });
  }
}
