import assert from "node:assert/strict";
import { consolidateGradedRevisitFamilies } from "../lib/gradedRevisitFamilies.ts";

const publication = { id: "publication-lead", familyId: "one-piece-jp-1", isPrintRun: false, pending: true };
const firstPrint = { id: "first-print-lead", familyId: "one-piece-jp-1", isPrintRun: true, pending: true };
const otherBook = { id: "other-lead", familyId: "other-book", isPrintRun: false, pending: true };

assert.deepEqual(consolidateGradedRevisitFamilies([firstPrint, publication, otherBook]).map((lead) => lead.id), ["publication-lead", "other-lead"]);
assert.equal(consolidateGradedRevisitFamilies([firstPrint, publication])[0].pending, true);

const reviewedPrint = { ...firstPrint, pending: false };
const reviewedFamily = consolidateGradedRevisitFamilies([publication, reviewedPrint]);
assert.equal(reviewedFamily.length, 1);
assert.equal(reviewedFamily[0].id, "first-print-lead");
assert.equal(reviewedFamily[0].pending, false, "one prior human decision resolves the same physical listing");

assert.deepEqual(consolidateGradedRevisitFamilies([firstPrint]), [firstPrint], "a first-print-only listing stays reviewable");
console.log("Graded revisit family consolidation passed.");
