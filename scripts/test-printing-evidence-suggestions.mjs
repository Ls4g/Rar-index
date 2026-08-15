import assert from "node:assert/strict";
import { assessPrintingEvidenceSuggestion, extractEvidenceImageUrl } from "../lib/printingEvidenceSuggestions.ts";

const proof = "https://images.example.com/copyright-page.jpg";

assert.equal(extractEvidenceImageUrl({ evidence_image_url: proof }), proof);
assert.equal(extractEvidenceImageUrl({ rar_import_metadata: { evidence_image_url: proof } }), proof);
assert.equal(extractEvidenceImageUrl({ evidence_image_url: "javascript:alert(1)" }), null);

const first = assessPrintingEvidenceSuggestion({
  listingTitle: "HUNTER x HUNTER Vol. 1 Manga 1st Printing",
  rawPayload: { evidence_image_url: proof },
});
assert.equal(first?.classification, "first_print_proven");
assert.equal(first?.printingNumber, 1);

const japaneseFirst = assessPrintingEvidenceSuggestion({
  listingTitle: "ONE PIECE 1 manga 第1刷",
  rawPayload: { rar_import_metadata: { evidence_image_url: proof } },
});
assert.equal(japaneseFirst?.classification, "first_print_proven");

const later = assessPrintingEvidenceSuggestion({
  listingTitle: "Naruto Vol 1 manga 9th printing",
  rawPayload: { evidence_image_url: proof },
});
assert.equal(later?.classification, "known_later_print");
assert.equal(later?.printingNumber, 9);

assert.equal(assessPrintingEvidenceSuggestion({
  listingTitle: "One Piece Volume 1 first edition manga",
  rawPayload: { evidence_image_url: proof },
}), null, "first edition wording alone must never become a print suggestion");

assert.equal(assessPrintingEvidenceSuggestion({
  listingTitle: "One Piece Volume 1 1st printing manga",
  rawPayload: {},
}), null, "title wording without a captured proof image is not actionable");

assert.equal(assessPrintingEvidenceSuggestion({
  listingTitle: "One Piece Volume 1 1st printing 2nd printing",
  rawPayload: { evidence_image_url: proof },
}), null, "conflicting print wording must be left to a person");

console.log("Printing evidence suggestion tests passed (8 scenarios).");
