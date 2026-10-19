// What RAR would make of a batch of Apify eBay rows, before anything is written.
//
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/report-apify-match.mjs <apify-dataset-id | path/to/rows.json>
//
// READ ONLY. It writes nothing to RAR and nothing to Apify. It creates no
// evidence, confirms no sale and queues nothing.
//
// Every decision shown here comes from lib/apifyListingIntake.ts, which is
// the same module scripts/queue-apify-listings.mjs uses to write. This script
// deliberately holds no opinion of its own: a preview that could disagree
// with the writer would be worse than no preview.
//
// Why a row is only ever "worth asking eBay about" and never a sale, and why
// the threshold is Scout's rather than something stricter, are both explained
// in that module.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadActiveScoutRules } from "../lib/scoutRules.ts";
import { classifyApifyRow, indexEditionsByIsbn } from "../lib/apifyListingIntake.ts";

const EDITION_COLUMNS =
  "id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no";

const source = process.argv[2];
if (!source) {
  console.error("Usage: report-apify-match.mjs <apify-dataset-id | path/to/rows.json>");
  process.exit(1);
}

async function loadRows(ref) {
  if (ref.endsWith(".json")) return JSON.parse(readFileSync(ref, "utf8"));
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set; add it to .env.local");
  // Reading an existing dataset costs nothing. This never starts a run, so it
  // cannot spend credit by accident.
  const res = await fetch(`https://api.apify.com/v2/datasets/${ref}/items?clean=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Apify dataset read failed: HTTP ${res.status}`);
  return res.json();
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const [rows, rules, editionResult] = await Promise.all([
  loadRows(source),
  loadActiveScoutRules(admin),
  admin.from("manga_editions").select(EDITION_COLUMNS),
]);
if (editionResult.error) throw new Error(`Could not read the catalogue: ${editionResult.error.message}`);

const editions = editionResult.data ?? [];
const byIsbn = indexEditionsByIsbn(editions);

console.log(`rows: ${rows.length}   catalogue: ${editions.length} editions, ${byIsbn.size} distinct ISBNs`);
console.log(`learned Scout rules active: ${rules.length}`);

const buckets = { queue: [], human: [], drop: [] };
for (const row of rows) {
  const label = `${String(row.itemId ?? "?").padEnd(13)} ${String(row.title ?? "").slice(0, 62)}`;
  const decision = classifyApifyRow(row, byIsbn, rules);
  buckets[decision.kind === "queue" ? "queue" : decision.kind].push({ label, decision });
}

function heading(text) {
  console.log(`\n${text}\n${"-".repeat(text.length)}`);
}

heading(`WOULD QUEUE FOR AN EBAY CHECK  (${buckets.queue.length})`);
for (const { label, decision } of buckets.queue) {
  const { edition, assessment } = decision.pick;
  const variant = edition.variant_name ? ` [${edition.variant_name}]` : "";
  console.log(label);
  console.log(`   -> ${edition.series} vol ${edition.volume_number}${variant}  ${assessment.confidence} ${assessment.score}  ${edition.id}`);
  if (decision.runnerUp) {
    console.log(`      chosen over printing=${decision.runnerUp.edition.printing_number ?? "-"} (${decision.runnerUp.assessment.score})`);
  }
}

heading(`NEEDS A HUMAN  (${buckets.human.length})`);
for (const { label, decision } of buckets.human) {
  console.log(label);
  console.log(`   ${decision.why}`);
  for (const candidate of decision.candidates) {
    const variant = candidate.edition.variant_name ? ` [${candidate.edition.variant_name}]` : "";
    console.log(`     candidate: ${candidate.edition.series} vol ${candidate.edition.volume_number}${variant} printing=${candidate.edition.printing_number ?? "-"}`);
  }
}

heading(`DROPPED  (${buckets.drop.length})`);
for (const { label, decision } of buckets.drop) {
  console.log(label);
  console.log(`   ${decision.why}`);
}

heading("SUMMARY");
console.log(`queue for an eBay check : ${buckets.queue.length}`);
console.log(`needs a human           : ${buckets.human.length}`);
console.log(`dropped                 : ${buckets.drop.length}`);
console.log(`total                   : ${rows.length}`);
console.log("\nNothing was written. No row here is a sale; each kept row is only a");
console.log("listing worth asking eBay about directly.");
