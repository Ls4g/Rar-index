import assert from "node:assert/strict";
import { confirmOutcomeSale, outcomeSaleFields } from "../lib/outcomeSaleConfirmation.ts";

const outcome = { id: "outcome-1", status: "sold_candidate", edition_id: "naruto-1", source_id: "ebay", external_id: "123456789012", source_listing_url: "https://www.ebay.co.uk/itm/123456789012", listing_title: "Naruto Vol 1 English VIZ Manga", sold_price: 42, sold_currency: "GBP", sold_at: "2026-08-01T10:00:00Z", buying_format: "AUCTION", original_snapshot: {}, outcome_provider: "eBay Trading GetItem", outcome_reason: "Completed with quantity sold" };
const raw = { humanConfirmed: true, grading: "raw" };
assert.throws(() => outcomeSaleFields(outcome, {}), /Confirm that you inspected/);
assert.throws(() => outcomeSaleFields(outcome, { humanConfirmed: true }), /raw or graded/);
for (const status of ["active", "unsold", "ambiguous", "inaccessible", "review_complete"]) assert.throws(() => outcomeSaleFields({ ...outcome, status }, raw), /Only a sold candidate/);
assert.throws(() => outcomeSaleFields({ ...outcome, sold_price: 0 }, raw));
assert.throws(() => outcomeSaleFields({ ...outcome, source_listing_url: "javascript:alert(1)" }, raw));
const graded = { ...outcome, listing_title: "Naruto Vol 1 CGC 9.8 English" };
assert.throws(() => outcomeSaleFields(graded, raw), /mentions grading/);
assert.throws(() => outcomeSaleFields(graded, { ...raw, grading: "graded", gradingCompany: "CGC" }), /exact grade/);
assert.equal(outcomeSaleFields(graded, { ...raw, grading: "graded", gradingCompany: "CGC", gradeLabel: "9.8" }).grade, "9.8");
const offer = { ...outcome, buying_format: "FIXED_PRICE,BEST_OFFER" };
assert.throws(() => outcomeSaleFields(offer, raw), /actual accepted price/);
assert.equal(outcomeSaleFields({ ...offer, outcome_provider: "130point manual corroboration" }, raw).saleType, "best_offer");
assert.equal(outcomeSaleFields({ ...outcome, buying_format: null }, raw).saleType, "unknown");

// Stateful database adapter: exercise the production orchestration, including
// durable evidence, queue filters, audit RPC boundaries and retry failures.
function database({ existing = null, lookupError = false, rpcError = false, closeError = false, raced = false } = {}) {
  const state = { sale: existing, outcome: { ...outcome, reviewed_by: null, resulting_observation_id: null }, rpcCalls: [], closeError, audits: 0 };
  return { state, async rpc(name, args) {
    assert.equal(name, "approve_submitted_sale"); state.rpcCalls.push(args);
    if (rpcError) return { data: null, error: { message: "transaction failed" } };
    state.sale = { id: "sale-1", edition_id: args.p_edition_id, match_status: "verified_match", sale_status: "confirmed", is_verified: true };
    state.audits++;
    return { data: state.sale.id, error: null };
  }, from(table) {
    const filters = []; let update = null;
    const query = {
      select() { return query; }, eq(key, value) { filters.push([key, value]); return query; }, is(key, value) { filters.push([key, value]); return query; },
      or(value) { assert.equal(value, "external_id.eq.123456789012,external_id.like.v1|123456789012|%"); return query; },
      update(values) { update = values; return query; },
      async maybeSingle() {
        if (table === "price_observations") return { data: state.sale, error: lookupError ? { message: "offline" } : null };
        assert.equal(table, "listing_outcomes");
        assert.ok(filters.some(([k,v]) => k === "reviewed_by" && v === null));
        assert.ok(filters.some(([k,v]) => k === "status" && v === "sold_candidate"));
        if (state.closeError || raced) return { data: null, error: state.closeError ? { message: "offline" } : null };
        Object.assign(state.outcome, update); return { data: { id: outcome.id }, error: null };
      },
    }; return query;
  }};
}
const db = database();
await confirmOutcomeSale(db, outcome, raw, "SP", null);
assert.equal(db.state.outcome.status, "review_complete");
assert.equal(db.state.audits, 1);
assert.equal(db.state.rpcCalls[0].p_grading_company, null);
assert.equal(db.state.rpcCalls[0].p_quantity, 1);
assert.equal(db.state.rpcCalls[0].p_sale_type, "auction");
assert.equal(db.state.rpcCalls[0].p_print_classification, "printing_not_identified");
const gradedDb = database();
await confirmOutcomeSale(gradedDb, graded, { ...raw, grading: "graded", gradingCompany: "CGC", gradeLabel: "9.8" }, "SP", null);
assert.equal(gradedDb.state.rpcCalls[0].p_grade_label, "9.8");
const restDb = database();
await confirmOutcomeSale(restDb, { ...outcome, external_id: "v1|123456789012|0" }, raw, "SP", null);
assert.equal(restDb.state.rpcCalls[0].p_external_id, "123456789012", "REST and legacy identifiers must share the same uniqueness key");
await assert.rejects(confirmOutcomeSale(database(), { ...outcome, external_id: "987654321098" }, raw, "SP", null), /do not agree/);
const retryDb = database({ closeError: true });
await assert.rejects(confirmOutcomeSale(retryDb, outcome, raw, "SP", null), /verified sale is saved/);
assert.equal(retryDb.state.outcome.status, "sold_candidate");
retryDb.state.closeError = false;
await confirmOutcomeSale(retryDb, outcome, raw, "SP", null);
assert.equal(retryDb.state.rpcCalls.length, 1, "queue retry must not reverify or duplicate evidence");
assert.equal(retryDb.state.outcome.status, "review_complete");
for (const option of [{ lookupError: true }, { rpcError: true }]) {
  const failed = database(option);
  await assert.rejects(confirmOutcomeSale(failed, outcome, raw, "SP", null));
  assert.equal(failed.state.sale, null);
  assert.equal(failed.state.audits, 0);
  assert.equal(failed.state.outcome.status, "sold_candidate");
}
for (const existing of [
  { id: "other", edition_id: "naruto-2", match_status: "verified_match", sale_status: "confirmed", is_verified: true },
  { id: "excluded", edition_id: "naruto-1", match_status: "excluded", sale_status: "confirmed", is_verified: false },
  { id: "pending", edition_id: "naruto-1", match_status: "needs_review", sale_status: "confirmed", is_verified: false },
]) {
  const protectedDb = database({ existing });
  await assert.rejects(confirmOutcomeSale(protectedDb, outcome, raw, "SP", null));
  assert.equal(protectedDb.state.rpcCalls.length, 0);
  assert.equal(protectedDb.state.outcome.status, "sold_candidate");
}
console.log("Outcome confirmation passed: grading, Best Offer, human confirmation, atomic intake, duplicate protection and durable queue retry.");
