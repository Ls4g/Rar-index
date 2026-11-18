import type { SupabaseClient } from "@supabase/supabase-js";

// Is any scheduled job broken? Answered from cron_invocations alone, so it
// costs one small query and works whatever the hosting plan keeps in logs.
//
// Two jobs failed silently for weeks in autumn 2026 (the reliability check
// from 18 Oct, the eBay sold search from 7 Nov) because nothing looked at
// these rows. A job is flagged when:
//   - its last two runs both failed, or
//   - it has not started at all for longer than a day and a half
//     (the schedule is daily), or
//   - a run started over two hours ago and never reported back (killed or
//     timed out before it could record a result).
// One failed run is shown but not alarmed: a single provider blip recovers.

export type JobRun = {
  route: string;
  started_at: string;
  finished_at: string | null;
  status: "started" | "completed" | "partial" | "failed";
  summary: Record<string, unknown> | null;
};

export type JobProblem = {
  job: string;
  label: string;
  severity: "alert" | "watch";
  reason: string;
  since: string | null;
  /** Fixed codes recorded by the run (never raw error text). */
  where: string[];
};

/** Every daily job in vercel.json, with a name a person reads. */
export const SCHEDULED_JOBS: { route: string; label: string }[] = [
  { route: "/api/cron/portfolio-snapshots", label: "Portfolio snapshots" },
  { route: "/api/cron/apify-sales", label: "Daily eBay sold search" },
  { route: "/api/cron/ebay-scout", label: "Live listing Scout" },
  { route: "/api/cron/listing-outcomes", label: "Watched listing outcomes" },
  { route: "/api/cron/rar-agents", label: "RAR agents" },
  { route: "/api/cron/agent-reliability", label: "Agent reliability check" },
  { route: "/api/cron/exchange-rates", label: "Exchange rates" },
];

const MISSING_AFTER_MS = 36 * 3_600_000;
const STUCK_AFTER_MS = 2 * 3_600_000;

function whereCodes(summary: Record<string, unknown> | null | undefined) {
  if (!summary) return [];
  const codes = Object.entries(summary)
    .filter(([key, value]) => value === true && /^(failed_|error_kind_|unreadable|checks_budget)/.test(key))
    .map(([key]) => key);
  return codes.slice(0, 6);
}

export function assessJobHealth(runs: JobRun[], now = Date.now(), jobs = SCHEDULED_JOBS): JobProblem[] {
  const problems: JobProblem[] = [];
  for (const job of jobs) {
    const mine = runs.filter((run) => run.route === job.route)
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at));
    const latest = mine[0];
    const name = job.route.replace("/api/cron/", "");
    if (!latest) {
      problems.push({ job: name, label: job.label, severity: "watch", reason: "No run recorded in the last 10 days.", since: null, where: [] });
      continue;
    }
    // Runs that finished; a still-"started" row younger than the stuck limit
    // may simply be running now.
    const stuck = latest.status === "started" && now - Date.parse(latest.started_at) > STUCK_AFTER_MS;
    const finished = mine.filter((run) => run.status !== "started" || now - Date.parse(run.started_at) > STUCK_AFTER_MS);
    const [last, previous] = finished;
    const failed = (run: JobRun | undefined) => Boolean(run && (run.status === "failed" || run.status === "started"));

    if (now - Date.parse(latest.started_at) > MISSING_AFTER_MS) {
      problems.push({ job: name, label: job.label, severity: "alert",
        reason: "Has not run for over a day and a half. The schedule may be broken or disabled.",
        since: latest.started_at, where: [] });
    } else if (failed(last) && failed(previous)) {
      let streak = 0;
      for (const run of finished) { if (failed(run)) streak += 1; else break; }
      const firstFailure = finished[streak - 1];
      problems.push({ job: name, label: job.label, severity: "alert",
        reason: streak === finished.length
          ? `Failed every run in the last 10 days (${streak} in a row, possibly longer).`
          : `Failed ${streak} runs in a row.`,
        since: firstFailure?.started_at ?? last!.started_at, where: whereCodes(last!.summary) });
    } else if (stuck) {
      problems.push({ job: name, label: job.label, severity: "watch",
        reason: "The last run started but never reported a result (killed or timed out).",
        since: latest.started_at, where: [] });
    } else if (failed(last)) {
      problems.push({ job: name, label: job.label, severity: "watch",
        reason: "The last run failed. One failure is often a provider blip; two in a row raises an alert.",
        since: last!.started_at, where: whereCodes(last!.summary) });
    }
  }
  return problems;
}

export async function readJobHealth(admin: SupabaseClient): Promise<JobProblem[] | null> {
  const since = new Date(Date.now() - 10 * 86_400_000).toISOString();
  const { data, error } = await admin.from("cron_invocations")
    .select("route,started_at,finished_at,status,summary")
    .eq("environment", "production")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(200);
  if (error) return null;
  return assessJobHealth((data ?? []) as JobRun[]);
}
