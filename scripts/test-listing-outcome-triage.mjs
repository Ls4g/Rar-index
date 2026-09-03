// Decision-inbox prioritisation. Run with:
//   node --experimental-strip-types scripts/test-listing-outcome-triage.mjs
import {
  classifyListingOutcome,
  dismissalDecision,
  dismissalNotes,
  outcomeMatchesQueue,
} from "../lib/listingOutcomeTriage.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

const now = new Date("2026-09-03T12:00:00.000Z");
const base = {
  status: "ended_pending_check",
  listingTitle: "Hunter x Hunter Vol. 1 Japanese Manga",
  askingPrice: 40,
  currency: "USD",
  soldPrice: null,
  soldCurrency: null,
  soldAt: null,
  buyingFormat: "FIXED_PRICE",
  matchScore: 70,
  matchConflicts: [],
  lastSeenAt: "2026-09-01T12:00:00.000Z",
};

console.log("\n--- only useful outcomes interrupt staff ---");
const plainEnded = classifyListingOutcome(base, now);
check("a normal ended listing without sale evidence is parked", !plainEnded.worthChecking && outcomeMatchesQueue(base, "parked", now));

const bestOffer = { ...base, buyingFormat: "BEST_OFFER" };
check("a matched Best Offer is worth checking", classifyListingOutcome(bestOffer, now).worthChecking);
check("the Best Offer filter includes it", outcomeMatchesQueue(bestOffer, "best_offer", now));

const soldCandidate = { ...base, status: "sold_candidate", soldPrice: 155, soldCurrency: "USD", soldAt: "2026-09-02" };
check("a sold candidate is always worth checking", classifyListingOutcome(soldCandidate, now).worthChecking);

const highValue = { ...base, askingPrice: 600 };
check("a high-value strong match is worth checking", classifyListingOutcome(highValue, now).worthChecking);
check("the high-value filter includes it", outcomeMatchesQueue(highValue, "high_value", now));

console.log("\n--- obvious non-comparables are separated ---");
const graded = { ...highValue, listingTitle: "BGS 8.0 Hunter x Hunter Vol. 1 Japanese Manga" };
check("a graded listing is not in Worth checking", !classifyListingOutcome(graded, now).worthChecking);
check("a graded listing has its own filter", outcomeMatchesQueue(graded, "graded", now));

const lot = { ...highValue, listingTitle: "Hunter x Hunter Manga Vol 1-10 complete set" };
check("a multi-volume lot is not in Worth checking", !classifyListingOutcome(lot, now).worthChecking);
check("a lot has its own filter", outcomeMatchesQueue(lot, "lot", now));

const conflict = { ...highValue, matchConflicts: ["publisher conflicts with edition"] };
check("an edition conflict is not in Worth checking", !classifyListingOutcome(conflict, now).worthChecking);
check("an edition conflict has its own filter", outcomeMatchesQueue(conflict, "conflict", now));

const stale = { ...base, lastSeenAt: "2026-07-01T12:00:00.000Z" };
check("an old unresolved listing is labelled stale", classifyListingOutcome(stale, now).isStale);

console.log("\n--- dismissal context is optional but retained when supplied ---");
check("no reason still maps to a safe dismissal", dismissalDecision("") === "dismiss");
check("no reason and no note sends an empty note", dismissalNotes("", "") === "");
check("wrong edition uses the existing audited decision", dismissalDecision("wrong_edition") === "wrong_edition");
check("a selected reason is written into the optional note", dismissalNotes("graded", "").includes("Graded listing"));
check("a typed note is preserved after the selected reason", dismissalNotes("lot", "Includes three books").endsWith("Includes three books"));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
