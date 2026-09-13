// Read-only production baseline. Run with node --env-file=.env.local.
import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
async function read(table, fields, order) {
  const rows = [];
  for (let from = 0; from < 10000; from += 1000) {
    let query = admin.from(table).select(fields).order(order).range(from, from + 999);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  throw new Error(`${table}: audit exceeded bounded scan; increase the bound explicitly.`);
}
const [runs, actions, outcomes, sales, evaluations] = await Promise.all([
  read("agent_runs", "id,agent_key,status,started_at,summary,error_message", "started_at"),
  read("agent_actions", "id,action_type,status,title,reviewed_at", "created_at"),
  read("listing_outcomes", "id,status,outcome_provider,listing_title,resulting_observation_id", "id"),
  read("price_observations", "id,listing_title,grading_company,grade_label,sale_type,match_status,sale_status,raw_payload", "id"),
  read("agent_evaluation_runs", "id,evaluator_key,case_count,metrics,created_at", "created_at"),
]);
const counts = (rows, key) => rows.reduce((result, row) => ({ ...result, [row[key]]: (result[row[key]] ?? 0) + 1 }), {});
const fromOutcomes = sales.filter(row => row.raw_payload?.rar_outcome_evidence);
console.log(JSON.stringify({
  capturedAt: new Date().toISOString(), latestRuns: runs.slice(-12),
  actions: counts(actions, "status"), openActions: actions.filter(row => ["proposed", "approved"].includes(row.status)),
  outcomes: counts(outcomes, "status"), outcomeOriginSales: fromOutcomes.length,
  gradedTitlesWithRawFields: fromOutcomes.filter(row => /\b(cgc|cbcs|psa|bgs|graded|slabbed)\b/i.test(row.listing_title) && !row.grading_company).map(row => ({ id: row.id, title: row.listing_title, status: row.match_status })),
  bestOfferAsFixed: fromOutcomes.filter(row => row.raw_payload?.rar_outcome_evidence?.provider === "130point manual corroboration" && row.sale_type !== "best_offer").length,
  latestEvaluations: evaluations.slice(-5),
}, null, 2));
