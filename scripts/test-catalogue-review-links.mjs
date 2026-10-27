import assert from "node:assert/strict";
import { openBdVisualReference } from "../lib/catalogueReviewLinks.ts";

assert.deepEqual(openBdVisualReference("OpenBD", "9784065134009"), {
  url: "https://www.kinokuniya.co.jp/f/dsg-01-9784065134009",
  label: "View ISBN-matched book",
});
assert.equal(openBdVisualReference("OpenBD", null), null);
assert.equal(openBdVisualReference("OpenBD", "978406513400"), null);
assert.equal(openBdVisualReference("Open Library", "9784065134009"), null);
console.log("Catalogue review links: passed");
