import Link from "next/link";
import { readJobHealth } from "@/lib/jobHealth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

// Shown under the staff navigation on every staff page, and only when a
// scheduled job needs attention. Silent when all is well, so it is not
// banner blindness waiting to happen.
export default async function JobHealthBanner() {
  let problems = null;
  try {
    problems = await readJobHealth(getSupabaseAdmin());
  } catch {
    problems = null;
  }
  if (!problems?.length) return null;
  const alerts = problems.filter((problem) => problem.severity === "alert");
  const shown = alerts.length ? alerts : problems;
  const date = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" }) : null;
  // A small fixed card, not part of the page flow: staff headers differ from
  // page to page, and this must not push any of them around. Collapsed to one
  // line by default; open it for the details.
  return (
    <aside className={`staff-job-health is-${alerts.length ? "alert" : "watch"}`} role={alerts.length ? "alert" : "status"}>
      <details>
        <summary>{alerts.length ? `${alerts.length} scheduled ${alerts.length === 1 ? "job needs" : "jobs need"} attention` : "A scheduled job to watch"}</summary>
        <ul>
          {shown.map((problem) => (
            <li key={problem.job}>
              <b>{problem.label}</b>: {problem.reason}
              {problem.since ? ` Since ${date(problem.since)}.` : ""}
              {problem.where.length ? <span className="staff-job-health-where"> Where: {problem.where.join(", ")}</span> : null}
            </li>
          ))}
        </ul>
        <Link href="/agents">Agent runs and health</Link>
      </details>
    </aside>
  );
}
