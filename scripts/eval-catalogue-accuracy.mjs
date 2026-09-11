// Score the Catalogue Curator against the decisions a human actually made.
//
//   node --experimental-strip-types scripts/eval-catalogue-accuracy.mjs
//
// The Curator is the weakest agent in RAR and the only one getting worse:
// 37% of its candidates rejected in July, 39% in August, 46% in September.
//
// Every staged row records the target it was matched against, in
// raw_payload.agent_discovery, so the match can be replayed exactly as it
// happened. That means we can ask the question that matters: of the
// candidates a human rejected, how many would TODAY's matcher still stage?
// Anything it would still stage is a live bug. Anything it now catches was
// already fixed and should not be counted against it.
//
// Read-only.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { candidateMatchesDiscoveryTarget } from "../lib/catalogueCurator.ts";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function pageAll(table, columns) {
  const rows = [];
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await admin.from(table).select(columns).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const decisions = await pageAll("catalogue_review_decisions", "catalogue_import_id,decision,decision_notes,created_at");
const queue = await pageAll("catalogue_import_queue",
  "id,candidate_title,candidate_series,candidate_volume_number,candidate_language,candidate_publisher,candidate_isbn_13,raw_payload");
const queueById = new Map(queue.map((row) => [row.id, row]));

// Replay only rows the agent staged. A candidate a human typed in by hand
// tells us nothing about the matcher.
const cases = [];
for (const decision of decisions) {
  const row = queueById.get(decision.catalogue_import_id);
  const discovery = row?.raw_payload?.agent_discovery;
  if (!row || !discovery) continue;
  const target = {
    key: discovery.target_key ?? "replay",
    source: discovery.source ?? "open_library",
    query: discovery.query ?? "",
    title: discovery.title ?? "",
    series: discovery.series ?? null,
    volumeNumber: discovery.volume_number ?? null,
    language: discovery.language ?? null,
    publisher: discovery.publisher ?? null,
    isbn13: discovery.isbn_13 ?? null,
    requestId: discovery.request_id ?? null,
    reason: discovery.reason ?? "lane_established",
  };
  cases.push({ row, target, decision: decision.decision, notes: decision.decision_notes, at: decision.created_at });
}

console.log(`agent-staged candidates with a human decision: ${cases.length}\n`);

const accepted = (c) => ["approve_new", "link_existing"].includes(c.decision);
const rejected = (c) => c.decision === "rejected";

let stillStages = 0;
let nowCaught = 0;
const liveBugs = [];

for (const item of cases.filter(rejected)) {
  const matches = candidateMatchesDiscoveryTarget({
    candidate_title: item.row.candidate_title,
    candidate_isbn_13: item.row.candidate_isbn_13,
    candidate_publisher: item.row.candidate_publisher,
    candidate_language: item.row.candidate_language,
    candidate_volume_number: item.row.candidate_volume_number,
  }, item.target);
  if (matches) {
    stillStages += 1;
    liveBugs.push({
      proposed: item.row.candidate_title,
      wanted: item.target.title,
      series: item.target.series,
      lang: `${item.row.candidate_language ?? "-"} vs ${item.target.language ?? "-"}`,
      note: item.notes,
    });
  } else nowCaught += 1;
}

const acc = cases.filter(accepted).length;
const rej = cases.filter(rejected).length;
console.log(`accepted by you : ${acc}`);
console.log(`rejected by you : ${rej}`);
console.log(`\nOf the ${rej} you rejected:`);
console.log(`  today's matcher would STILL stage : ${stillStages}   <- live bugs`);
console.log(`  today's matcher now catches       : ${nowCaught}   <- already fixed`);

// How many good ones would a stricter rule cost? Anything that breaks these
// is not worth shipping.
let acceptedStillMatch = 0;
for (const item of cases.filter(accepted)) {
  const matches = candidateMatchesDiscoveryTarget({
    candidate_title: item.row.candidate_title,
    candidate_isbn_13: item.row.candidate_isbn_13,
    candidate_publisher: item.row.candidate_publisher,
    candidate_language: item.row.candidate_language,
    candidate_volume_number: item.row.candidate_volume_number,
  }, item.target);
  if (matches) acceptedStillMatch += 1;
}
console.log(`\nOf the ${acc} you accepted, today's matcher still matches ${acceptedStillMatch}.`);
console.log("   (a new rule must not reduce this number)");

if (liveBugs.length) {
  console.log(`\n---------------- what still gets through (${liveBugs.length}) ----------------`);
  liveBugs.slice(0, 25).forEach((bug) => {
    console.log(`\n  staged : ${String(bug.proposed).slice(0, 66)}`);
    console.log(`  wanted : ${String(bug.wanted).slice(0, 66)}`);
    console.log(`  lang   : ${bug.lang}`);
    if (bug.note) console.log(`  you    : ${String(bug.note).slice(0, 80)}`);
  });
}
