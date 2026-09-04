import { assessOutcomeConfidence } from "../lib/listingOutcomeConfidence.ts";
import { classifyStaffPageSignal } from "../lib/listingPageEvidence.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

const now = new Date("2026-09-04T12:00:00.000Z");
const base = {
  status: "ended_pending_check",
  scheduledEndAt: null,
  soldPrice: null,
  soldCurrency: null,
  soldAt: null,
  observationId: null,
  checks: [],
};

console.log("\n--- outcome confidence stays separate and honest ---");
const stale = assessOutcomeConfidence(base, now);
check("a listing merely unseen by Scout is not labelled ended", stale.label === "Status check due" && stale.score === 20, JSON.stringify(stale));

const explicitEnd = assessOutcomeConfidence({ ...base, scheduledEndAt: "2026-09-03T12:00:00.000Z" }, now);
check("a passed end time is useful but does not prove sold or unsold", explicitEnd.label === "End time passed" && explicitEnd.score < 50);

const soldPage = assessOutcomeConfidence({
  ...base,
  status: "ambiguous",
  checks: [{ provider: "eBay page — staff observed", state: "completed_sold", detail: "green sold", checkedAt: now.toISOString() }],
}, now);
check("green plus sold wording is a strong signal", soldPage.score === 85 && soldPage.label === "Sold page observed");
check("green sold evidence without price/date is not a confirmed sale", soldPage.score < 95 && soldPage.meaning.includes("price"));

const active = assessOutcomeConfidence({
  ...base,
  status: "active",
  checks: [{ provider: "eBay Browse", state: "active", detail: "readable", checkedAt: now.toISOString() }],
}, now);
check("an API-confirmed active listing gets strong active confidence", active.score === 90 && active.label === "Still live");

console.log("\n--- staff page observations never fabricate a sale ---");
const green = classifyStaffPageSignal("green_sold");
check("green and sold wording remains ambiguous until paid price/date exist", green.listingState === "completed_sold" && green.resultingStatus === "ambiguous");
const red = classifyStaffPageSignal("red_ended");
check("red and ended wording resolves as unsold", red.listingState === "completed_unsold" && red.resultingStatus === "unsold");
const live = classifyStaffPageSignal("still_live");
check("staff can return a listing to active watching", live.resultingStatus === "active");
const unclear = classifyStaffPageSignal("unclear");
check("unclear evidence stays ambiguous", unclear.resultingStatus === "ambiguous");

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
