import assert from "node:assert/strict";
import { confirmOutcomeSale, outcomeSaleFields, storedLegacyItemId } from "../lib/outcomeSaleConfirmation.ts";

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
assert.equal(outcomeSaleFields(offer, raw).corroboration, outcome.source_listing_url, "the working original eBay sold page is the accepted-price proof");
assert.equal(outcomeSaleFields({ ...offer, outcome_provider: "130point manual corroboration" }, raw).saleType, "best_offer");
assert.equal(outcomeSaleFields({ ...outcome, buying_format: null }, raw).saleType, "unknown");

// Orchestration now lives in one database transaction (`confirm_outcome_sale`),
// so what the mock can honestly test is the CONTRACT: which function is
// called, with exactly which arguments, and what the caller does with each
// answer. Whether that transaction is genuinely atomic is not something a mock
// can show -- scripts/test-outcome-sale-atomicity.mjs proves that against a
// real PostgreSQL engine running the shipped migration.
function database({ error = null, result = undefined } = {}) {
  const state = { calls: [] };
  return { state, async rpc(name, args) {
    assert.equal(name, "confirm_outcome_sale", "confirmation must go through the transactional function");
    state.calls.push(args);
    if (error) return { data: null, error: { message: error } };
    // `result: null` is a case under test, so it must not fall through to the
    // default the way `??` would.
    return { data: result === undefined ? { ok: true, status: "review_complete", observationId: "sale-1", reused: false, alreadyClosed: false } : result, error: null };
  }};
}

const db = database();
const confirmed = await confirmOutcomeSale(db, outcome, raw, "SP", null);
assert.equal(db.state.calls.length, 1, "one approval is one call");
assert.equal(confirmed.status, "review_complete");
assert.equal(confirmed.observationId, "sale-1");
const sent = db.state.calls[0];
assert.equal(sent.p_outcome_id, "outcome-1");
assert.equal(sent.p_legacy_external_id, "123456789012");
assert.equal(sent.p_sale_type, "auction");
assert.equal(sent.p_grading_company, null);
assert.equal(sent.p_reviewed_by, "SP");
// Printing is its own human judgement with its own evidence; confirming a sale
// must never assert one.
assert.equal(sent.p_submitted_payload.human_confirmation.single_copy_item_price_excludes_delivery, true);
assert.equal(sent.p_submitted_payload.rar_outcome_evidence.provider, "eBay Trading GetItem");

const gradedDb = database();
await confirmOutcomeSale(gradedDb, graded, { ...raw, grading: "graded", gradingCompany: "CGC", gradeLabel: "9.8" }, "SP", null);
assert.equal(gradedDb.state.calls[0].p_grading_company, "CGC");
assert.equal(gradedDb.state.calls[0].p_grade_label, "9.8");

const offerDb = database();
await confirmOutcomeSale(offerDb, { ...offer, outcome_provider: "130point manual corroboration" }, raw, "SP", null);
assert.equal(offerDb.state.calls[0].p_sale_type, "best_offer");
assert.equal(offerDb.state.calls[0].p_price_corroboration_url, "https://130point.com/sales/");

const ebayOfferDb = database();
await confirmOutcomeSale(ebayOfferDb, { ...offer, outcome_provider: "eBay sold page — staff observed accepted price" }, raw, "SP", null);
assert.equal(ebayOfferDb.state.calls[0].p_price_corroboration_url, outcome.source_listing_url);

// Both spellings of an eBay listing id resolve to the one uniqueness key.
const restDb = database();
await confirmOutcomeSale(restDb, { ...outcome, external_id: "v1|123456789012|0" }, raw, "SP", null);
assert.equal(restDb.state.calls[0].p_legacy_external_id, "123456789012", "REST and legacy identifiers must share the same uniqueness key");
assert.equal(storedLegacyItemId("v1|123456789012|0"), "123456789012");
assert.equal(storedLegacyItemId("123456789012"), "123456789012");
// A URL that disagrees with the stored id is refused before anything is sent.
const mismatchDb = database();
await assert.rejects(confirmOutcomeSale(mismatchDb, { ...outcome, external_id: "987654321098" }, raw, "SP", null), /do not agree/);
assert.equal(mismatchDb.state.calls.length, 0, "a mismatch must not reach the database at all");

// An idempotent retry is reported as a reuse, not as a fresh verification.
const replayed = await confirmOutcomeSale(
  database({ result: { ok: true, status: "review_complete", observationId: "sale-1", reused: true, alreadyClosed: true } }),
  outcome, raw, "SP", null);
assert.equal(replayed.reused, true);
assert.equal(replayed.alreadyClosed, true);
assert.equal(replayed.observationId, "sale-1");

// Database refusals are surfaced as written -- they are the message staff read.
await assert.rejects(confirmOutcomeSale(database({ error: "Already reviewed by COLLEAGUE. Refresh before deciding again; nothing was changed." }), outcome, raw, "SP", null), /Already reviewed by COLLEAGUE/);
await assert.rejects(confirmOutcomeSale(database({ error: "This marketplace listing already exists in RAR" }), outcome, raw, "SP", null), /will not be duplicated/);
// An unapplied migration must say so plainly rather than looking like a data problem.
await assert.rejects(confirmOutcomeSale(database({ error: 'Could not find the function public.confirm_outcome_sale in the schema cache' }), outcome, raw, "SP", null), /outstanding migration/);
// No answer at all is a failure, never a silent success.
await assert.rejects(confirmOutcomeSale(database({ result: null }), outcome, raw, "SP", null), /Nothing was verified/);

console.log("Outcome confirmation passed: grading, Best Offer, human confirmation, canonical listing id, transactional call contract and retry reporting.");
