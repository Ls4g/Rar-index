import assert from "node:assert/strict";
import { resolvePriceImportEdition } from "../lib/priceImportEditionResolver.ts";

const edition = (overrides = {}) => ({
  id: "one-piece-en",
  title: "One Piece, Vol. 1",
  series: "One Piece",
  volume_number: "1",
  language: "English",
  isbn_13: "9781569319017",
  publisher: "VIZ Media",
  format: "Paperback",
  printing_number: null,
  edition_statement: null,
  variant_name: null,
  ...overrides,
});

const candidate = (overrides = {}) => ({
  title: "One Piece Vol. 1",
  series: "One Piece",
  volume_number: "1",
  language: "English",
  isbn_13: "9781569319017",
  publisher: "VIZ Media",
  format: "Paperback",
  ...overrides,
});

const english = edition();
const japanese = edition({
  id: "one-piece-ja",
  title: "ONE PIECE 1",
  language: "Japanese",
  isbn_13: "9784088725093",
  publisher: "Shueisha",
});

const exactIsbn = resolvePriceImportEdition([english, japanese], candidate());
assert.equal(exactIsbn.status, "resolved");
assert.equal(exactIsbn.status === "resolved" && exactIsbn.edition.id, english.id);
assert.equal(exactIsbn.status === "resolved" && exactIsbn.method, "isbn");

const titleOnly = resolvePriceImportEdition([english, japanese], candidate({ isbn_13: null }));
assert.equal(titleOnly.status, "resolved");
assert.equal(titleOnly.status === "resolved" && titleOnly.edition.id, english.id);
assert.equal(titleOnly.status === "resolved" && titleOnly.method, "ranked");

const ambiguous = resolvePriceImportEdition([
  english,
  edition({ id: "one-piece-en-second-record", isbn_13: null }),
], candidate({ isbn_13: null, publisher: null, format: null }));
assert.equal(ambiguous.status, "blocked");
assert.match(ambiguous.status === "blocked" ? ambiguous.issue : "", /more than one RAR edition is plausible/);

const sharedIsbn = resolvePriceImportEdition([
  english,
  edition({ id: "one-piece-en-print-run", printing_number: 1 }),
], candidate());
assert.equal(sharedIsbn.status, "blocked");
assert.match(sharedIsbn.status === "blocked" ? sharedIsbn.issue : "", /ISBN matches more than one RAR edition/);

const insufficient = resolvePriceImportEdition([english, japanese], candidate({
  title: "Unknown manga book",
  series: null,
  volume_number: null,
  language: null,
  isbn_13: null,
  publisher: null,
  format: null,
}));
assert.equal(insufficient.status, "blocked");

const forcedConflict = resolvePriceImportEdition([english, japanese], candidate({ language: "Japanese" }), english);
assert.equal(forcedConflict.status, "blocked");
assert.match(forcedConflict.status === "blocked" ? forcedConflict.issue : "", /conflicts with the selected edition/);

console.log("price import edition resolution checks passed");
