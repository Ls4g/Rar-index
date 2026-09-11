// Score RAR's Scout matcher against the decisions a human actually made.
//
//   node --experimental-strip-types scripts/eval-scout-accuracy.mjs
//
// Why this exists: every accuracy change so far has been a guess, because
// nothing measured whether it helped. RAR already holds the answer key --
// 815 leads a named human ruled on by hand -- so the matcher can be scored
// against real judgements rather than against intuition.
//
// The number that matters is NOT overall accuracy. Dismissing everything
// scores ~93% here because most leads are junk. What matters is the two
// error types, which cost completely different things:
//
//   MISSED BUY  - the human said "watching", the matcher said dismiss.
//                 A real buying opportunity thrown away silently. Expensive,
//                 and invisible, which is worse.
//   WASTED LOOK - the human said "dismissed", the matcher kept it.
//                 Costs a few seconds of review. Cheap.
//
// Read-only. Decides nothing, writes nothing.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assessScoutListing } from "../lib/scoutIngest.ts";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function pageAll(table, columns, filter = (q) => q) {
  const rows = [];
  for (let page = 0; page < 30; page += 1) {
    const { data, error } = await filter(admin.from(table).select(columns)).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// Only decisions a person made. Auto-triage rows are the thing being graded,
// so grading against them would just measure the matcher against itself.
const HUMAN = /^(SP)$/i;

const decisions = (await pageAll("scout_lead_decisions", "lead_id,decision,reviewed_by,created_at"))
  .filter((row) => HUMAN.test((row.reviewed_by ?? "").trim()));

// One lead can be ruled on more than once; the most recent human call wins.
const verdict = new Map();
for (const row of decisions.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
  verdict.set(row.lead_id, row.decision);
}

const leads = await pageAll("scout_listing_leads", "id,profile_id,listing_title,listing_price,currency");
const leadById = new Map(leads.map((lead) => [lead.id, lead]));

const profiles = await pageAll("marketplace_search_profiles", "id,edition_id");
const editionIdByProfile = new Map(profiles.map((profile) => [profile.id, profile.edition_id]));

const editions = await pageAll("manga_editions",
  "id,title,series,volume_number,language,publisher,isbn_13,edition_statement,printing_number,variant_name,format,collectible_type");
const editionById = new Map(editions.map((edition) => [edition.id, edition]));

const cases = [];
for (const [leadId, humanCall] of verdict) {
  const lead = leadById.get(leadId);
  if (!lead) continue;
  const edition = editionById.get(editionIdByProfile.get(lead.profile_id));
  if (!edition || !lead.listing_title) continue;
  cases.push({ lead, edition, humanCall });
}

console.log(`Human decisions found: ${verdict.size}`);
console.log(`Scoreable (lead + edition still present): ${cases.length}\n`);

// The shipped auto-dismiss rule: a "conflict" verdict is what gets binned.
const tally = { agree_keep: 0, agree_bin: 0, missedBuy: 0, wastedLook: 0 };
const missed = [];

for (const item of cases) {
  const assessment = assessScoutListing(item.edition, item.lead.listing_title);
  const agentWouldBin = assessment.confidence === "conflict";
  const humanBinned = item.humanCall === "dismissed";

  if (agentWouldBin && humanBinned) tally.agree_bin += 1;
  else if (!agentWouldBin && !humanBinned) tally.agree_keep += 1;
  else if (agentWouldBin && !humanBinned) {
    tally.missedBuy += 1;
    missed.push({
      title: item.lead.listing_title.slice(0, 62),
      edition: `${item.edition.series ?? item.edition.title} v${item.edition.volume_number ?? "?"} (${item.edition.language ?? "?"})`,
      why: assessment.conflicts.slice(0, 2).join("; "),
    });
  } else tally.wastedLook += 1;
}

const humanKept = tally.agree_keep + tally.missedBuy;
const humanBinned = tally.agree_bin + tally.wastedLook;
const total = cases.length;

console.log("================= AGENT vs HUMAN =================");
console.log(`human kept (watching):   ${humanKept}`);
console.log(`human binned (dismissed):${humanBinned}`);
console.log();
console.log(`agreed - binned junk:    ${tally.agree_bin}`);
console.log(`agreed - kept a buy:     ${tally.agree_keep}`);
console.log(`MISSED BUY (agent binned a real one): ${tally.missedBuy}`);
console.log(`wasted look (agent kept junk):        ${tally.wastedLook}`);
console.log();
console.log(`overall agreement: ${((tally.agree_bin + tally.agree_keep) / total * 100).toFixed(1)}%`);
if (humanKept) {
  console.log(`RECALL on real buys: ${(tally.agree_keep / humanKept * 100).toFixed(1)}%  <- the number that matters`);
  console.log(`   (${tally.missedBuy} of ${humanKept} genuine opportunities would have been silently dropped)`);
}
if (humanBinned) {
  console.log(`junk correctly removed: ${(tally.agree_bin / humanBinned * 100).toFixed(1)}%`);
}

if (missed.length) {
  console.log(`\n--- Real buys the matcher would have thrown away (${Math.min(12, missed.length)} of ${missed.length}) ---`);
  missed.slice(0, 12).forEach((m) => {
    console.log(`  ${m.title}`);
    console.log(`     wanted: ${m.edition}`);
    console.log(`     binned because: ${m.why || "(no reason recorded)"}`);
  });
}

// ---------------------------------------------------------------- why ----
// The junk that still reaches a human is the whole cost of this queue, so
// group it by what a person could see and the matcher could not.
const wasted = [];
for (const item of cases) {
  const assessment = assessScoutListing(item.edition, item.lead.listing_title);
  if (assessment.confidence === "conflict") continue;
  if (item.humanCall !== "dismissed") continue;
  wasted.push(item);
}

const LOT = /\b(lot|set|bundle|collection|complete|volumes?\s*\d+\s*[-–]\s*\d+|\d+\s*[-–]\s*\d+)\b/i;
const NOT_A_BOOK = /\b(card|figure|poster|keychain|plush|sticker|badge|funko|shirt|mug|acrylic|cosplay|banner|art print)\b/i;
const DIGITAL = /\b(digital|pdf|ebook|kindle|download)\b/i;

const buckets = {};
const examples = {};
for (const item of wasted) {
  const t = item.lead.listing_title;
  const volInTitle = t.match(/vol(?:ume)?\.?\s*(\d{1,3})/i)?.[1];
  const wantVol = String(item.edition.volume_number ?? "").match(/\d+/)?.[0];
  let bucket;
  if (NOT_A_BOOK.test(t)) bucket = "not a book (merch/cards)";
  else if (LOT.test(t)) bucket = "lot / multi-volume set";
  else if (DIGITAL.test(t)) bucket = "digital, not a physical copy";
  else if (volInTitle && wantVol && volInTitle !== wantVol) bucket = "wrong volume number";
  else if (!volInTitle && wantVol) bucket = "no volume stated in title";
  else bucket = "looks right on text - human used judgement";
  buckets[bucket] = (buckets[bucket] || 0) + 1;
  (examples[bucket] ||= []).push(`${t.slice(0, 60)}  [wanted v${wantVol ?? "?"}]`);
}

console.log(`\n================ WHY JUNK REACHES YOU (${wasted.length}) ================`);
Object.entries(buckets).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  console.log(`\n${String(v).padStart(4)}  ${k}`);
  (examples[k] || []).slice(0, 3).forEach((e) => console.log(`        ${e}`));
});
