// Bulk decisions on watched listings. Run with:
//   node --experimental-strip-types scripts/test-listing-outcome-decisions.mjs
//
// Selecting rows with checkboxes makes it cheap to apply a decision to forty
// listings at once. That is the point, and it is also the risk: the one
// decision here that CREATES evidence must never become a thing you can do
// forty at a time without looking. Every case below is a way that could
// happen.
import {
  BULK_SAFE_DECISIONS,
  OUTCOME_DECISIONS,
  decisionsFor,
  isBulkSafeDecision,
  sharedDecisionsFor,
} from "../lib/listingOutcomeDecisions.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

const soldCandidate = { status: "sold_candidate", soldPrice: 42, soldCurrency: "USD", soldAt: "2026-08-01" };
const endedPending = { status: "ended_pending_check", soldPrice: null, soldCurrency: null, soldAt: null };
const ambiguous = { status: "ambiguous", soldPrice: null, soldCurrency: null, soldAt: null };
const inaccessible = { status: "inaccessible", soldPrice: null, soldCurrency: null, soldAt: null };
const active = { status: "active", soldPrice: null, soldCurrency: null, soldAt: null };

const keys = (list) => list.map((decision) => decision.key);

console.log("\n--- verifying a sale is never a bulk action ---");
check("confirm_sale is not bulk-safe", !isBulkSafeDecision("confirm_sale"));
check("confirm_sale is absent from the bulk-safe list", !BULK_SAFE_DECISIONS.includes("confirm_sale"));
// The strongest form of the rule: no selection of any shape, however
// homogeneous, can surface it.
check(
  "no selection of sold candidates offers it in bulk",
  !keys(sharedDecisionsFor([soldCandidate, soldCandidate, soldCandidate])).includes("confirm_sale"),
  JSON.stringify(keys(sharedDecisionsFor([soldCandidate, soldCandidate]))),
);
check("a single selected sold candidate still does not offer it", !keys(sharedDecisionsFor([soldCandidate])).includes("confirm_sale"));
// ...while the row's own buttons still do, because that is one deliberate act.
check("its own row still offers it individually", keys(decisionsFor(soldCandidate)).includes("confirm_sale"));

console.log("\n--- a batch never exceeds what each row allows ---");
{
  // "It did not sell" is meaningless for a listing that has not ended, so
  // mixing a live listing into the selection must withdraw it for everyone.
  const mixed = sharedDecisionsFor([endedPending, active]);
  check("mixing a live listing withdraws mark_unsold", !keys(mixed).includes("mark_unsold"), JSON.stringify(keys(mixed)));
  check("mark_unsold is available when nothing is live", keys(sharedDecisionsFor([endedPending, ambiguous])).includes("mark_unsold"));
  check("a live listing alone never offers mark_unsold", !keys(decisionsFor(active)).includes("mark_unsold"));
}
{
  // keep_watching only applies to an uncertain outcome. A selection including
  // something already unsold must not offer it.
  const unsold = { status: "unsold", soldPrice: null, soldCurrency: null, soldAt: null };
  check("keep_watching withdrawn when a settled row is selected", !keys(sharedDecisionsFor([ambiguous, unsold])).includes("keep_watching"));
  check("keep_watching offered across uncertain rows", keys(sharedDecisionsFor([ambiguous, inaccessible, endedPending])).includes("keep_watching"));
}
{
  // The intersection must be exactly that -- never a union.
  const shared = keys(sharedDecisionsFor([endedPending, active]));
  const union = new Set([...keys(decisionsFor(endedPending)), ...keys(decisionsFor(active))]);
  check("the shared set is a strict subset of the union", shared.every((key) => union.has(key)) && shared.length < union.size);
  check("every shared decision is allowed on every row", shared.every((key) =>
    [endedPending, active].every((row) => keys(decisionsFor(row)).includes(key))));
}

console.log("\n--- the always-available triage decisions ---");
for (const row of [soldCandidate, endedPending, ambiguous, inaccessible, active]) {
  const available = keys(decisionsFor(row));
  check(`${row.status}: wrong_edition, mark_ambiguous and dismiss are offered`,
    ["wrong_edition", "mark_ambiguous", "dismiss"].every((key) => available.includes(key)), JSON.stringify(available));
}
check("an empty selection offers nothing", sharedDecisionsFor([]).length === 0);

console.log("\n--- confirm_sale needs a real price, currency and date ---");
check("no price means no confirm", !keys(decisionsFor({ ...soldCandidate, soldPrice: null })).includes("confirm_sale"));
check("no currency means no confirm", !keys(decisionsFor({ ...soldCandidate, soldCurrency: null })).includes("confirm_sale"));
check("no date means no confirm", !keys(decisionsFor({ ...soldCandidate, soldAt: null })).includes("confirm_sale"));
check("a non-candidate status means no confirm", !keys(decisionsFor({ ...soldCandidate, status: "ambiguous" })).includes("confirm_sale"));

console.log("\n--- the two lists stay in step ---");
check("every bulk-safe key is a real decision", BULK_SAFE_DECISIONS.every((key) => OUTCOME_DECISIONS.some((decision) => decision.key === key)));
check("bulk-safe is exactly the decisions minus confirm_sale",
  BULK_SAFE_DECISIONS.length === OUTCOME_DECISIONS.length - 1);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
