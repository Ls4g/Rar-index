// Read-only production operations report. It never starts a cron, changes a
// decision, resolves an incident, or writes a health record.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = new URL("../.env.local", import.meta.url);
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([^#][^=]*)=(.*)$/);
    if (match) process.env[match[1].trim()] ??= match[2].trim().replace(/^['"]|['"]$/g, "");
  }
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Load RAR's Supabase environment or add a local .env.local before running this read-only report.");
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function query(name, request) {
  const { data, error, count } = await request;
  return error ? { name, error: error.message } : { name, data: data ?? [], count: count ?? null };
}

const [runs, cycles, incidents, reliability, scans, outcomes, snapshots] = await Promise.all([
  query("agent_runs", admin.from("agent_runs").select("agent_key,status,trigger_source,started_at,finished_at,error_message,summary,metrics").order("started_at", { ascending: false }).limit(40)),
  query("agent_cycles", admin.from("agent_cycles").select("status,trigger_source,started_at,finished_at,total_agents,successful_agents,failed_agents,blocked_agents,summary").order("started_at", { ascending: false }).limit(10)),
  query("open_agent_incidents", admin.from("agent_incidents").select("incident_key,incident_type,severity,status,title,updated_at").eq("status", "open").order("updated_at", { ascending: false }).limit(50)),
  query("agent_evaluation_runs", admin.from("agent_evaluation_runs").select("agent_key,evaluator_key,passed,case_count,positive_count,negative_count,distinct_subjects,regression_count,created_at").order("created_at", { ascending: false }).limit(30)),
  query("scout_scans", admin.from("scout_scans").select("status,result_count,error_message,scanned_at").order("scanned_at", { ascending: false }).limit(100)),
  query("listing_outcomes", admin.from("listing_outcomes").select("status,next_check_at,last_checked_at,check_attempts,updated_at").order("updated_at", { ascending: false }).limit(1000)),
  query("portfolio_snapshots", admin.from("portfolio_snapshots").select("snapshot_at,trigger_reason").order("snapshot_at", { ascending: false }).limit(20)),
]);

const rows = (result) => result.data ?? [];
const latestBy = (items, key) => {
  const found = new Map();
  for (const item of items) if (!found.has(item[key])) found.set(item[key], item);
  return [...found.values()];
};
const outcomeCounts = Object.fromEntries(rows(outcomes).reduce((map, item) => map.set(item.status, (map.get(item.status) ?? 0) + 1), new Map()));
const now = Date.now();

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  safety: "Read-only report; no cron or production mutation was invoked.",
  latestAgentRuns: latestBy(rows(runs), "agent_key"),
  latestCycle: rows(cycles)[0] ?? null,
  openIncidents: rows(incidents),
  latestReliabilityByEvaluator: latestBy(rows(reliability), "evaluator_key"),
  recentScoutScans: {
    sample: rows(scans).length,
    failed: rows(scans).filter((item) => item.status === "failed").length,
    latestAt: rows(scans)[0]?.scanned_at ?? null,
    latestFailure: rows(scans).find((item) => item.status === "failed") ?? null,
  },
  listingOutcomes: {
    sampled: rows(outcomes).length,
    byStatus: outcomeCounts,
    dueUnresolved: rows(outcomes).filter((item) => item.next_check_at && Date.parse(item.next_check_at) <= now && !["sold_candidate", "sold_confirmed", "unsold", "dismissed", "wrong_edition"].includes(item.status)).length,
  },
  latestPortfolioSnapshot: rows(snapshots)[0] ?? null,
  queryErrors: [runs, cycles, incidents, reliability, scans, outcomes, snapshots].filter((result) => result.error).map((result) => ({ name: result.name, error: result.error })),
}, null, 2));
