// One-time correction: put back in the queue the listings that were never
// really checked.
//
//   node --experimental-strip-types scripts/requeue-unchecked-outcomes.mjs          (dry run)
//   node --experimental-strip-types scripts/requeue-unchecked-outcomes.mjs --apply  (writes)
//
// Why these rows are wrong
// ------------------------
// Until 24f61ca, RAR sent eBay the RESTful item id ("v1|175537033747|0") on an
// endpoint that wants the bare number. Every call returned 404. The classifier
// reads "not found" as inaccessible and marks it resolved, so each listing was
// parked with a verdict that came from a request eBay never understood.
//
// Those rows cannot heal on their own. "inaccessible" is excluded from the
// check query AND from isDueForCheck, and resolved rows get next_check_at
// null, so nothing will ever look at them again.
//
// What this does
// --------------
// Moves them to ended_pending_check with the retry counter cleared, which is
// the one state runOutcomeChecks will pick up. The very next check settles it
// properly: Browse answering 200/active sets the row straight back to active,
// a real 404 returns it to inaccessible having actually been asked, and a
// genuine completed sale becomes a sold candidate for a human.
//
// What it will not touch
// ----------------------
//   - any row a human has reviewed (reviewed_by set)
//   - any row that already produced a sale (resulting_observation_id set)
//   - any row whose check was made by a person ("eBay page — staff observed")
// A recorded human decision is never overwritten, which is the rule this
// project runs on.
//
// Every change is written to listing_outcome_checks as well, so the reason a
// row moved is inspectable in the same audit trail humans use.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes("--apply");

const REASON = "Queued for re-check: the original check sent eBay a malformed item id and never actually reached the listing, so the previous verdict was never evidence of anything.";

// PostgREST caps a response at 1000 rows whatever .limit() says, so this has
// to page. Reading only the first page is how an earlier count in this
// session reported 400 when the real figure was over a thousand.
async function pageAll() {
  const all = [];
  for (let page = 0; page < 40; page += 1) {
    const { data, error } = await admin
      .from("listing_outcomes")
      .select("id, external_id, listing_title, status, check_attempts, outcome_provider, last_checked_at")
      .eq("status", "inaccessible")
      .is("reviewed_by", null)
      .is("resulting_observation_id", null)
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

const rows = await pageAll();
const targets = rows.filter((row) => row.outcome_provider !== "eBay page — staff observed");
const skippedStaff = rows.length - targets.length;

console.log(`inaccessible, no human decision, no sale : ${(rows ?? []).length}`);
console.log(`skipped (a person checked the page)     : ${skippedStaff}`);
console.log(`to be re-queued                         : ${targets.length}`);
console.log(`\nAt ${160} checks per run that is ${Math.ceil(targets.length / 160)} runs of "Run outcome checks now".`);

if (!targets.length) process.exit(0);

console.log("\nsample of what moves:");
targets.slice(0, 5).forEach((row) => {
  console.log(`  ${String(row.listing_title).slice(0, 54)}`);
  console.log(`     attempts ${row.check_attempts} · last checked ${row.last_checked_at?.slice(0, 10) ?? "never"} · via ${row.outcome_provider ?? "-"}`);
});

if (!APPLY) {
  console.log("\nDRY RUN. Nothing was written. Re-run with --apply to make the change.");
  process.exit(0);
}

const now = new Date().toISOString();
let moved = 0;
let failed = 0;

for (let index = 0; index < targets.length; index += 50) {
  const chunk = targets.slice(index, index + 50);
  await Promise.all(chunk.map(async (row) => {
    // Audit first: if the status update fails, the record of the attempt
    // still exists rather than the row changing with no explanation.
    const { error: auditError } = await admin.from("listing_outcome_checks").insert({
      outcome_id: row.id,
      provider: "RAR correction — malformed item id",
      attempt_number: (row.check_attempts ?? 0) + 1,
      http_status: null,
      listing_state: "unknown",
      resulting_status: "ended_pending_check",
      detail: REASON,
      raw_response: { correction: "requeue_after_item_id_fix", previous_status: "inaccessible", previous_attempts: row.check_attempts },
      checked_at: now,
    });
    if (auditError) { failed += 1; return; }

    const { error: updateError } = await admin.from("listing_outcomes").update({
      status: "ended_pending_check",
      check_attempts: 0,
      next_check_at: null,
      last_error: null,
      outcome_reason: REASON,
      outcome_provider: null,
      updated_at: now,
    }).eq("id", row.id).is("reviewed_by", null).is("resulting_observation_id", null);

    if (updateError) failed += 1; else moved += 1;
  }));
  process.stdout.write(`\r  re-queued ${moved}/${targets.length}`);
}

console.log(`\n\nre-queued: ${moved}`);
if (failed) console.log(`failed   : ${failed}`);
console.log('\nNow press "Run outcome checks now" on /listing-outcomes until the due count reaches zero.');
