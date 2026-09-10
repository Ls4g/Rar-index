// Aggregate-only reliability alert diagnosis. This report reads the latest
// evaluation results without printing reviewer identities, subject IDs, notes,
// listing titles, source URLs, or benchmark input snapshots.
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

const { data: runs, error: runsError } = await admin.from("agent_evaluation_runs")
  .select("id,evaluator_key,passed,case_count,regression_count,metrics,gates,created_at")
  .order("created_at", { ascending: false })
  .limit(50);
if (runsError) throw new Error(runsError.message);

const latest = new Map();
for (const run of runs ?? []) if (!latest.has(run.evaluator_key)) latest.set(run.evaluator_key, run);

const runIds = [...latest.values()].map((run) => run.id);
const { data: failures, error: failuresError } = runIds.length
  ? await admin.from("agent_evaluation_case_results")
    .select("evaluation_run_id,expected_outcome,predicted_outcome,critical_failure,diagnostics,case:agent_benchmark_cases(reason_label)")
    .in("evaluation_run_id", runIds)
    .eq("passed", false)
  : { data: [], error: null };
if (failuresError) throw new Error(failuresError.message);

function increment(map, key) {
  map[key] = (map[key] ?? 0) + 1;
}

function diagnosticSignature(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "none";
  return Object.entries(value)
    .filter(([, item]) => typeof item === "boolean" || item === null)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${key}=${item}`)
    .join(",") || "non-boolean-diagnostics";
}

const output = [...latest.values()].map((run) => {
  const runFailures = (failures ?? []).filter((item) => item.evaluation_run_id === run.id);
  const transitions = {};
  const reasonLabels = {};
  const diagnosticSignatures = {};
  const conflictCategories = {};
  for (const failure of runFailures) {
    increment(transitions, `${failure.expected_outcome}->${failure.predicted_outcome}`);
    increment(reasonLabels, failure.case?.reason_label ?? "unlabelled");
    increment(diagnosticSignatures, diagnosticSignature(failure.diagnostics));
    for (const conflict of Array.isArray(failure.diagnostics?.conflicts) ? failure.diagnostics.conflicts : []) {
      if (typeof conflict === "string") increment(conflictCategories, conflict);
    }
  }
  return {
    evaluator: run.evaluator_key,
    createdAt: run.created_at,
    passed: run.passed,
    cases: run.case_count,
    failures: runFailures.length,
    criticalFailures: run.regression_count,
    failedGates: Object.fromEntries(Object.entries(run.gates ?? {}).filter(([, gate]) => gate?.passed === false)),
    metrics: run.metrics,
    failureTransitions: transitions,
    failureReasonLabels: reasonLabels,
    failureDiagnosticSignatures: diagnosticSignatures,
    failureConflictCategories: conflictCategories,
  };
});

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  safety: "Aggregate-only read; no production mutation or private benchmark input emitted.",
  suites: output,
}, null, 2));
