import assert from "node:assert/strict";
import { runOutcomeChecks } from "../lib/watchToSale.ts";

const base = { id: "outcome", external_id: "v1|123456789012|0", marketplace: "EBAY_GB", listing_title: "Berserk Volume 1 English Dark Horse", status: "ambiguous", scheduled_end_at: "2026-08-01T00:00:00Z", next_check_at: "2026-08-02T00:00:00Z", check_attempts: 1, outcome_provider: "eBay Trading GetItem", reviewed_by: null, resulting_observation_id: null };
function database({ auditError = false, queueError = false } = {}) {
  const state = { row: { ...base }, audits: 0 };
  return { state, from(table) {
    let update; let filters = [];
    const result = () => {
      if (table === "listing_outcome_checks") { state.audits++; return { data: null, error: auditError ? { message: "audit unavailable" } : null }; }
      assert.equal(table, "listing_outcomes");
      const matches = filters.every(([key,value]) => state.row[key] === value);
      if (update) {
        assert.ok(filters.some(([key]) => key === "reviewed_by"));
        assert.ok(filters.some(([key]) => key === "check_attempts"));
        if (matches) Object.assign(state.row, update);
        return { data: matches ? { id: base.id } : null, error: null };
      }
      return { data: matches ? [{ ...state.row }] : [], error: queueError ? { message: "offline" } : null };
    };
    const q = { select() { return q; }, eq(k,v) { filters.push([k,v]); return q; }, is(k,v) { filters.push([k,v]); return q; }, in() { return q; }, or() { return q; }, order() { return q; }, limit() { return q; },
      update(v) { update=v; return q; }, insert() { return q; }, maybeSingle: async () => result(), then(a,b) { return Promise.resolve(result()).then(a,b); } }; return q;
  }};
}
const signal = { signal: { provider: "eBay Trading GetItem", listingState: "completed_unsold", soldPrice: null, soldCurrency: null, soldAt: null, bidCount: 0, buyingFormat: "AUCTION", bestOfferAccepted: null, scheduledEndAt: base.scheduled_end_at, httpStatus: 200, detail: "Completed with zero quantity sold" }, httpStatus: 200, rawResponse: {} };
const healthy = database();
const completed = await runOutcomeChecks(healthy, 1, async () => signal);
assert.equal(healthy.state.row.status, "unsold");
assert.equal(completed.unsold, 1);
assert.equal(healthy.state.audits, 1);
for (const providerFails of [false, true]) {
  const db = database();
  const result = await runOutcomeChecks(db, 1, async () => {
    db.state.row.reviewed_by = "SP";
    db.state.row.next_check_at = null;
    if (providerFails) throw new Error("eBay timeout");
    return signal;
  });
  assert.equal(db.state.row.status, "ambiguous", "human ambiguity decision cannot be overwritten");
  assert.equal(db.state.row.next_check_at, null, "failure cannot reschedule human-resolved work");
  assert.equal(db.state.row.check_attempts, 1);
  assert.equal(result.checked, 0, "protected writes are not reported as successful classifications");
  assert.equal(db.state.audits, 1, "late result remains inspectable");
}
const auditFailure = database({ auditError: true });
const failed = await runOutcomeChecks(auditFailure, 1, async () => signal);
assert.equal(auditFailure.state.row.status, "ambiguous");
assert.equal(failed.checked, 0);
assert.equal(failed.errors.length, 1);
await assert.rejects(runOutcomeChecks(database({ queueError: true }), 1, async () => signal), /could not load/);
const reviewed = database(); reviewed.state.row.reviewed_by = "SP";
assert.equal((await runOutcomeChecks(reviewed, 1, async () => { throw new Error("must not call eBay"); })).due, 0);
console.log("Outcome worker passed: successful checks, human-decision races, provider failure, audit failure and queue failure.");

// --- Daily ceiling ---------------------------------------------------------
// The per-run bound cannot hold a day on its own: /api/listing-outcomes runs a
// batch on staff action as well as the cron, so 11 September reached 1,573
// checks at a per-run limit of 160. Raising the limit without a ceiling would
// have made that day roughly 4,000 calls.
{
  const { DAILY_OUTCOME_CHECK_CEILING, DEFAULT_OUTCOME_CHECK_LIMIT } = await import("../lib/watchToSale.ts");
  assert.ok(DEFAULT_OUTCOME_CHECK_LIMIT <= DAILY_OUTCOME_CHECK_CEILING,
    "a single run must never be allowed to exhaust the day");

  // A ceiling that is already spent stops the batch without erroring, and
  // without touching the queue.
  const spentDb = {
    from(table) {
      if (table === "listing_outcome_checks") {
        return { select: () => ({ gte: () => Promise.resolve({ count: DAILY_OUTCOME_CHECK_CEILING, error: null }) }) };
      }
      throw new Error("the queue must not be read once the ceiling is spent");
    },
  };
  const stopped = await runOutcomeChecks(spentDb, 400, async () => { throw new Error("must not call eBay"); });
  assert.equal(stopped.ceilingReached, true);
  assert.equal(stopped.checked, 0);
  assert.equal(stopped.dailyRemaining, 0);
  assert.deepEqual(stopped.errors, [], "a spent ceiling is a budget state, not an error");

  // A ceiling that cannot be read must not stop real work.
  const blindDb = {
    from(table) {
      if (table === "listing_outcome_checks") {
        return { select: () => ({ gte: () => Promise.resolve({ count: null, error: { message: "unreadable" } }) }) };
      }
      return { select: () => ({ in: () => ({ is: () => ({ is: () => ({ or: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }) }) }) }) }) };
    },
  };
  const blind = await runOutcomeChecks(blindDb, 400, async () => { throw new Error("no rows, so no call"); });
  assert.equal(blind.ceilingReached, false, "an unreadable count must not be treated as a spent ceiling");
  assert.equal(blind.dailySpent, null);
  assert.equal(blind.dailyRemaining, null);
}

console.log("Outcome daily ceiling passed: spent ceiling halts without error, unreadable count never blocks work.\n");
