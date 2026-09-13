// Scout junk reduction, measured against the decisions staff actually made.
//
//   node --experimental-strip-types --env-file=.env.local scripts/eval-scout-junk-reduction.mjs
//   node --experimental-strip-types --env-file=.env.local scripts/eval-scout-junk-reduction.mjs --show-misses
//
// READ ONLY against production. Writes nothing, changes no rule, activates
// nothing.
//
// The bar this has to clear is asymmetric and deliberately so. A junk lead
// that reaches a human costs a few seconds. A genuine buying opportunity that
// RAR throws away is gone silently and nobody ever learns it existed. So
// recall is the constraint and junk rejection is the thing being optimised
// underneath it -- never the other way round.
//
// Development and holdout are split by a stable hash of the case id, so the
// split does not move between runs and a rule cannot be tuned until it happens
// to fit. Rules are designed by looking at DEVELOPMENT misses only; the
// holdout figures are the ones reported.
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { evaluateReliabilityCase } from "../lib/agentReliability.ts";
import { loadActiveScoutRules } from "../lib/scoutRules.ts";
import { conservativeJunkDismissal, JUNK_RULES } from "../lib/scoutJunkRules.ts";

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const showMisses = process.argv.includes("--show-misses");

async function readAll(table, columns, filter) {
  const rows = [];
  for (let from = 0; from < 20000; from += 1000) {
    let query = admin.from(table).select(columns).order("id").range(from, from + 999);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
  throw new Error(`${table}: exceeded the bounded scan.`);
}

const cases = await readAll(
  "agent_benchmark_cases",
  "id,agent_key,evaluator_key,subject_key,input_snapshot,expected_outcome,reason_label,reviewed_by,decided_at,created_at",
  (query) => query.eq("evaluator_key", "market_scout_match"),
);
const rules = await loadActiveScoutRules(admin);

// A stable 50/50 split. Hashing the id means the same case lands in the same
// half every run, on every machine, for ever.
function isHoldout(id) {
  return parseInt(createHash("sha256").update(String(id)).digest("hex").slice(0, 8), 16) % 2 === 0;
}

function measure(subset, dismiss) {
  let truePositive = 0, falseNegative = 0, trueNegative = 0, falsePositive = 0;
  const newlyLost = [], newlyRejected = [];
  for (const item of subset) {
    const base = evaluateReliabilityCase(item, rules);
    const snapshot = item.input_snapshot ?? {};
    const extra = dismiss ? dismiss(snapshot.edition ?? {}, snapshot.listingTitle ?? "") : null;
    const predicted = base.predictedOutcome === "dismiss" || extra?.shouldDismiss ? "dismiss" : "useful";
    const wanted = item.expected_outcome;
    if (wanted === "useful") {
      if (predicted === "useful") truePositive += 1;
      else {
        falseNegative += 1;
        if (extra?.shouldDismiss && base.predictedOutcome !== "dismiss") newlyLost.push({ item, rule: extra.rule, reason: extra.reason });
      }
    } else if (predicted === "dismiss") {
      trueNegative += 1;
      if (extra?.shouldDismiss && base.predictedOutcome !== "dismiss") newlyRejected.push({ item, rule: extra.rule });
    } else falsePositive += 1;
  }
  const usefulTotal = truePositive + falseNegative;
  const junkTotal = trueNegative + falsePositive;
  return {
    cases: subset.length, truePositive, falseNegative, trueNegative, falsePositive,
    recall: usefulTotal ? truePositive / usefulTotal : 0,
    junkRejection: junkTotal ? trueNegative / junkTotal : 0,
    usefulTotal, junkTotal, newlyLost, newlyRejected,
  };
}

function report(label, result) {
  console.log(`\n${label}`);
  console.log(`  cases                 ${result.cases}`);
  console.log(`  genuine recall        ${result.truePositive}/${result.usefulTotal} = ${(result.recall * 100).toFixed(2)}%`);
  console.log(`  junk rejection        ${result.trueNegative}/${result.junkTotal} = ${(result.junkRejection * 100).toFixed(2)}%`);
  console.log(`  junk still shown      ${result.falsePositive}`);
}

const development = cases.filter((item) => !isHoldout(item.id));
const holdout = cases.filter((item) => isHoldout(item.id));

console.log(`\nScout benchmark: ${cases.length} human decisions`);
console.log(`Active learned rules: ${rules.length}`);
console.log(`Split: ${development.length} development / ${holdout.length} holdout (stable hash of case id)`);

console.log(`\n${"=".repeat(62)}\nBASELINE -- the scorer as it ships today\n${"=".repeat(62)}`);
const baseAll = measure(cases, null);
report("whole benchmark", baseAll);
const baseDev = measure(development, null);
const baseHold = measure(holdout, null);
report("development half", baseDev);
report("holdout half", baseHold);

if (showMisses) {
  console.log(`\n${"=".repeat(62)}\nDEVELOPMENT junk that still reaches a human (rules are designed from these only)\n${"=".repeat(62)}`);
  const shown = new Map();
  for (const item of development) {
    const base = evaluateReliabilityCase(item, rules);
    if (base.predictedOutcome !== "useful" || item.expected_outcome !== "dismiss") continue;
    const key = item.reason_label ?? "no label";
    if (!shown.has(key)) shown.set(key, []);
    shown.get(key).push(item);
  }
  for (const [label, items] of [...shown.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n  ${label} (${items.length})`);
    for (const item of items.slice(0, 12)) {
      const edition = item.input_snapshot?.edition ?? {};
      console.log(`    "${String(item.input_snapshot?.listingTitle ?? "").slice(0, 74)}"`);
      console.log(`       wanted: ${edition.series ?? "?"} v${edition.volume_number ?? "?"} ${edition.language ?? "?"} ${edition.publisher ?? ""}`);
    }
  }
  process.exit(0);
}

console.log(`\n${"=".repeat(62)}\nCANDIDATE RULES -- each alone, on the DEVELOPMENT half\n${"=".repeat(62)}`);
for (const rule of JUNK_RULES) {
  const single = measure(development, (edition, title) => {
    const hit = rule.matches(edition, title);
    return hit ? { shouldDismiss: true, rule: rule.key, reason: hit } : null;
  });
  const lost = single.newlyLost.length;
  const gained = single.newlyRejected.length;
  const verdict = lost === 0 ? "SAFE" : `LOSES ${lost}`;
  console.log(`  ${verdict.padEnd(10)} ${rule.key.padEnd(26)} +${String(gained).padStart(3)} junk rejected, -${lost} genuine`);
  if (lost > 0) {
    for (const miss of single.newlyLost.slice(0, 3)) {
      console.log(`       lost: "${String(miss.item.input_snapshot?.listingTitle ?? "").slice(0, 68)}"`);
    }
  }
}

console.log(`\n${"=".repeat(62)}\nCOMBINED -- all rules together\n${"=".repeat(62)}`);
const afterDev = measure(development, conservativeJunkDismissal);
report("development half", afterDev);
console.log(`  junk newly rejected   ${afterDev.newlyRejected.length}`);
console.log(`  genuine newly lost    ${afterDev.newlyLost.length}`);

const afterHold = measure(holdout, conservativeJunkDismissal);
console.log(`\n${"=".repeat(62)}\nHOLDOUT -- never looked at while designing the rules\n${"=".repeat(62)}`);
report("before", baseHold);
report("after", afterHold);
console.log(`\n  junk newly rejected   ${afterHold.newlyRejected.length}`);
console.log(`  genuine newly lost    ${afterHold.newlyLost.length}`);
for (const miss of afterHold.newlyLost) {
  console.log(`    LOST by ${miss.rule}: "${String(miss.item.input_snapshot?.listingTitle ?? "").slice(0, 66)}"`);
}

const recallDrop = baseHold.recall - afterHold.recall;
console.log(`\n${"=".repeat(62)}`);
console.log(`  recall        ${(baseHold.recall * 100).toFixed(2)}%  ->  ${(afterHold.recall * 100).toFixed(2)}%   (${recallDrop <= 0 ? "no loss" : `-${(recallDrop * 100).toFixed(2)} points`})`);
console.log(`  junk rejected ${(baseHold.junkRejection * 100).toFixed(2)}%  ->  ${(afterHold.junkRejection * 100).toFixed(2)}%`);
console.log(`\n  VERDICT: ${afterHold.newlyLost.length === 0
  ? "safe to activate -- no genuine opportunity lost on unseen cases."
  : `KEEP IN SHADOW MODE -- ${afterHold.newlyLost.length} genuine opportunities lost on unseen cases.`}`);
console.log("\nNothing was written. Activation remains a separate human decision.\n");
