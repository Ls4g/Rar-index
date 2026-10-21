import type { SupabaseClient } from "@supabase/supabase-js";

export type CronName = "ebay-scout" | "portfolio-snapshots" | "rar-agents" | "agent-reliability" | "listing-outcomes";

// Only bounded operational counts enter the heartbeat. Never persist request
// URLs/headers, raw errors, listing payloads or holder identities here.
export function summarizeCronResponse(name: CronName, status: number, body: Record<string, unknown>) {
  const summary: Record<string, number | boolean> = {};
  const collect = (value: unknown, keys: string[], prefix = "") => {
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const item = record[key];
      if (typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) summary[prefix + key] = item;
    }
  };
  collect(body, ["createdProfiles", "scannedProfiles", "activeLeads", "failures", "usersChecked", "created", "skipped", "failed", "promoted"]);
  collect(body.captured, ["captured", "updated", "skipped"], "capture_");
  collect(body.checks, ["checked", "soldCandidates", "unsold", "ambiguous", "inaccessible", "stillActive", "budgetUnavailable", "ceilingReached"], "checks_");
  collect(body.cycle, ["successful", "failed", "blocked"], "cycle_");
  const checks = body.checks as { errors?: unknown } | undefined;
  if (Array.isArray(checks?.errors)) summary.check_errors = checks.errors.length;
  if (name === "agent-reliability") {
    const result = body.result as { runs?: { passed?: boolean }[] } | undefined;
    if (Array.isArray(result?.runs)) {
      summary.evaluations = result.runs.length;
      summary.failed_gates = result.runs.filter((run) => run.passed === false).length;
    }
  }
  const state = status >= 400 || summary.checks_budgetUnavailable === true ? "failed"
    : status === 207 || body.ok === false || Number(summary.failures ?? 0) > 0
      || Number(summary.failed ?? 0) > 0 || Number(summary.cycle_failed ?? 0) > 0
      || Number(summary.cycle_blocked ?? 0) > 0 || Number(summary.check_errors ?? 0) > 0
      || Number(summary.failed_gates ?? 0) > 0 ? "partial" : "completed";
  return { status: state, summary };
}

// Call only AFTER route authorization. Observability failure must not disable
// an otherwise working job. Logs + response headers explicitly flag lost audit.
export async function runRecordedCron(
  name: CronName,
  createAdmin: () => SupabaseClient,
  work: (admin: SupabaseClient) => Promise<Response>,
): Promise<Response> {
  const id = crypto.randomUUID();
  const route = `/api/cron/${name}`;
  const startedAt = new Date().toISOString();
  const environment = ["production", "preview", "development"].includes(process.env.VERCEL_ENV ?? "")
    ? process.env.VERCEL_ENV! : "unknown";
  const commit = /^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "") ? process.env.VERCEL_GIT_COMMIT_SHA! : null;
  console.info(JSON.stringify({ event: "cron_started", id, route, environment, commit, started_at: startedAt }));
  let admin: SupabaseClient | undefined;
  let started = false;
  let recorded = false;
  const write = async (values: Record<string, unknown>, insert: boolean) => {
    try {
      if (!admin) return false;
      const query = insert ? admin.from("cron_invocations").insert(values)
        : admin.from("cron_invocations").update(values).eq("id", id);
      const { error } = await query.abortSignal(AbortSignal.timeout(3000));
      if (error) throw new Error("Heartbeat write failed");
      return true;
    } catch {
      console.error(JSON.stringify({ event: "cron_heartbeat_unavailable", id, route, stage: insert ? "start" : "finish" }));
      return false;
    }
  };
  let response: Response;
  try {
    admin = createAdmin();
    started = await write({ id, route, environment, commit_sha: commit, started_at: startedAt, status: "started" }, true);
    response = await work(admin);
  } catch {
    // Never echo an arbitrary provider exception (which can contain secrets).
    response = Response.json({ error: "Scheduled job failed. Inspect its existing operational records." }, { status: 500 });
  }
  let result: ReturnType<typeof summarizeCronResponse>;
  try {
    result = summarizeCronResponse(name, response.status, await response.clone().json());
  } catch {
    result = { status: "failed", summary: { unreadable_response: true } };
  }
  const finished = { ...result, finished_at: new Date().toISOString(), http_status: response.status };
  if (started) recorded = await write(finished, false);
  console.info(JSON.stringify({ event: "cron_finished", id, route, ...finished, recorded }));
  response.headers.set("X-RAR-Cron-Run", id);
  response.headers.set("X-RAR-Cron-Recorded", String(recorded));
  return response;
}
