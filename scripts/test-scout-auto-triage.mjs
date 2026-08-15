import assert from "node:assert/strict";
import { decideScoutAutoDismiss } from "../lib/scoutAutoTriage.ts";

const target = {
  title: "Bleach, Vol. 1",
  series: "Bleach",
  volume_number: "1",
  language: "English",
  isbn_13: "9781591164418",
  publisher: "VIZ Media",
  format: "Paperback",
  printing_number: 1,
  edition_statement: "First printing",
  variant_name: null,
  collectible_type: "tankobon",
  issue_year: null,
  issue_number_label: null,
  cumulative_issue_no: null,
};

const cases = [
  ["leading-zero volume is still the selected volume", "Bleach, Vol. 01 Paperback", false],
  ["hash-one book shorthand stays human-controlled", "Bleach #1 VIZ 2004 Paperback", false],
  ["exact-looking listing stays human-controlled", "Bleach Vol 1 Manga English VIZ First Print", false],
  ["wrong volume is dismissed", "Bleach Vol 8 Manga English VIZ", true],
  ["multi-volume lot is dismissed", "Bleach Manga Vol 1-10 Complete Set English", true],
  ["wrong ISBN is dismissed", "Bleach Vol 1 ISBN 9781234567897", true],
  ["wrong language is dismissed", "Bleach Vol 1 Japanese Manga", true],
  ["wrong binding is dismissed", "Bleach Vol 1 Hardcover English VIZ", true],
  ["later printing is dismissed", "Bleach Vol 1 English VIZ 9th Printing", true],
  ["thin title remains human-controlled", "Rare manga book volume one", false],
  ["missing evidence remains human-controlled", "Bleach manga book", false],
];

for (const [name, title, expected] of cases) {
  const decision = decideScoutAutoDismiss(target, title);
  assert.equal(decision.shouldDismiss, expected, `${name}: ${decision.conflicts.join("; ")}`);
  if (decision.shouldDismiss) assert.ok(decision.note?.startsWith("Auto-dismissed by RAR Market Scout:"));
}

console.log(`Scout safe-autonomy tests passed (${cases.length} cases).`);
