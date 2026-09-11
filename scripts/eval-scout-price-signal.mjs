// Would a price signal remove the junk that text matching cannot?
//
//   node --experimental-strip-types scripts/eval-scout-price-signal.mjs
//
// Scored against the same 811 human decisions as eval-scout-accuracy.mjs.
//
// The benchmark is deliberately NOT verified sales: RAR has those for only a
// handful of editions. It is the median asking price of the other live
// listings Scout already found for the SAME edition. Every edition with a
// queue therefore has a benchmark, immediately.
//
// EVIDENCE RULE: this is triage ordering only. Active listing prices rank
// what a human looks at first and never touch a valuation, a chart, or a
// sale. AGENTS.md allows automation to narrow what a human sees; it forbids
// letting an asking price become evidence. Nothing here is stored as
// evidence or shown as a value.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assessScoutListing } from "../lib/scoutIngest.ts";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function pageAll(table, columns) {
  const rows = [];
  for (let page = 0; page < 30; page += 1) {
    const { data, error } = await admin.from(table).select(columns).range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

const decisions = (await pageAll("scout_lead_decisions", "lead_id,decision,reviewed_by,created_at"))
  .filter((row) => (row.reviewed_by ?? "").trim() === "SP")
  .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
const verdict = new Map();
for (const row of decisions) verdict.set(row.lead_id, row.decision);

const leads = await pageAll("scout_listing_leads", "id,profile_id,listing_title,listing_price,currency");
const leadById = new Map(leads.map((lead) => [lead.id, lead]));
const profiles = await pageAll("marketplace_search_profiles", "id,edition_id");
const editionIdByProfile = new Map(profiles.map((p) => [p.id, p.edition_id]));
const editions = await pageAll("manga_editions",
  "id,title,series,volume_number,language,publisher,isbn_13,edition_statement,printing_number,variant_name,format,collectible_type");
const editionById = new Map(editions.map((e) => [e.id, e]));

// Benchmark: median asking price across every live lead for that edition.
const pricesByEdition = new Map();
for (const lead of leads) {
  const editionId = editionIdByProfile.get(lead.profile_id);
  if (!editionId || typeof lead.listing_price !== "number") continue;
  (pricesByEdition.get(editionId) ?? pricesByEdition.set(editionId, []).get(editionId)).push(lead.listing_price);
}
const medianByEdition = new Map();
for (const [editionId, values] of pricesByEdition) {
  if (values.length < 5) continue; // too thin to be a benchmark
  const sorted = [...values].sort((a, b) => a - b);
  medianByEdition.set(editionId, sorted[Math.floor(sorted.length / 2)]);
}

const cases = [];
for (const [leadId, humanCall] of verdict) {
  const lead = leadById.get(leadId);
  if (!lead?.listing_title) continue;
  const editionId = editionIdByProfile.get(lead.profile_id);
  const edition = editionById.get(editionId);
  if (!edition) continue;
  cases.push({ lead, edition, humanCall, median: medianByEdition.get(editionId) ?? null });
}

function score(multiplier) {
  const t = { agreeBin: 0, agreeKeep: 0, missedBuy: 0, wastedLook: 0 };
  for (const item of cases) {
    const textConflict = assessScoutListing(item.edition, item.lead.listing_title).confidence === "conflict";
    const price = item.lead.listing_price;
    const overpriced = multiplier !== null
      && item.median !== null
      && typeof price === "number"
      && price > item.median * multiplier;
    const agentBins = textConflict || overpriced;
    const humanBinned = item.humanCall === "dismissed";
    if (agentBins && humanBinned) t.agreeBin += 1;
    else if (!agentBins && !humanBinned) t.agreeKeep += 1;
    else if (agentBins && !humanBinned) t.missedBuy += 1;
    else t.wastedLook += 1;
  }
  return t;
}

const humanKept = cases.filter((c) => c.humanCall !== "dismissed").length;
const humanBinned = cases.length - humanKept;
console.log(`Scoreable: ${cases.length}   (human kept ${humanKept}, human dismissed ${humanBinned})`);
console.log(`Editions with a usable price benchmark: ${medianByEdition.size}\n`);

console.log("rule                         junk removed      real buys kept     wasted looks");
for (const multiplier of [null, 10, 6, 4, 3, 2.5, 2]) {
  const t = score(multiplier);
  const recall = (t.agreeKeep / humanKept * 100);
  const junk = (t.agreeBin / humanBinned * 100);
  const label = multiplier === null ? "text only (today)" : `text + price > ${multiplier}x median`;
  console.log(
    label.padEnd(28),
    `${junk.toFixed(1).padStart(5)}%`.padEnd(17),
    `${recall.toFixed(1).padStart(5)}%`.padEnd(18),
    String(t.wastedLook).padStart(4),
    t.missedBuy ? `  (${t.missedBuy} real buys lost)` : "  (0 lost)",
  );
}

// ------------------------------------------------------- rank, not bin ----
// Auto-dismissing on price loses real buys, which is the one error that is
// silent and therefore the one worth avoiding. Ordering costs nothing: put
// the plausible buys first and the outliers last, and the queue is worked
// top-down until the reviewer stops. Nothing is ever thrown away.
const ranked = cases
  .filter((c) => typeof c.lead.listing_price === "number" && c.median)
  .map((c) => ({ ...c, ratio: c.lead.listing_price / c.median }))
  .sort((a, b) => a.ratio - b.ratio);

const base = cases.filter((c) => c.humanCall !== "dismissed").length / cases.length;
console.log(`\n---------------- ranking by price vs edition median ----------------`);
console.log(`leads with a benchmark: ${ranked.length}`);
console.log(`baseline hit rate (any lead is a real buy): ${(base * 100).toFixed(1)}%\n`);
console.log("first N of the queue    real buys    hit rate");
for (const n of [25, 50, 100, 200]) {
  if (n > ranked.length) continue;
  const slice = ranked.slice(0, n);
  const hits = slice.filter((c) => c.humanCall !== "dismissed").length;
  console.log(`top ${String(n).padStart(3)}`.padEnd(24), String(hits).padStart(6), `      ${(hits / n * 100).toFixed(1)}%`);
}
const worstN = 100;
const tail = ranked.slice(-worstN);
const tailHits = tail.filter((c) => c.humanCall !== "dismissed").length;
console.log(`\nbottom ${worstN} (most overpriced): ${tailHits} real buys = ${(tailHits / worstN * 100).toFixed(1)}% hit rate`);
console.log("   -> these are what currently sit at the top of your queue unsorted");
