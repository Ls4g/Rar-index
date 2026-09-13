// Pagination over listing outcomes, against a dataset whose every row is known.
//
// The page used to cap its queries at 200/75/25 rows, so 1506 of 1812 outcomes
// could not be opened at all and the tab counts staff read were a sample, not a
// total. These checks are about the property that replaced it: walking the pages
// of a view must yield every matching row exactly once, in a deterministic
// order, whatever the reviewer filters or sorts by.
import {
  OUTCOME_QUEUES,
  browseOutcomes,
  normalisePage,
  normaliseQueue,
  normaliseSort,
  normaliseView,
  outcomeView,
  sortOutcomes,
} from "../lib/outcomeBrowsing.ts";

let checks = 0;
let failures = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) { console.log(`  ok   ${label}`); return true; }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

const NOW = new Date("2026-09-13T21:00:00.000Z");

// Deterministic synthetic rows. Ids are deliberately not in sorted order so a
// tiebreak that silently relies on input order shows up as a failure.
function makeRow(index, overrides = {}) {
  const id = `row-${String((index * 7919) % 1000).padStart(4, "0")}-${index}`;
  return {
    id,
    externalId: `1${String(100000 + index)}`,
    editionLabel: `Series ${index % 11} · Vol. ${index % 5} · English`,
    listingTitle: `Manga Volume ${index % 5} listing number ${index}`,
    status: "ended_pending_check",
    reviewedBy: null,
    checkAttempts: 1,
    askingPrice: 10 + (index % 50),
    currency: "GBP",
    soldPrice: null,
    soldCurrency: null,
    soldAt: null,
    buyingFormat: "AUCTION",
    matchScore: index % 101,
    matchConflicts: [],
    lastSeenAt: new Date(Date.parse("2026-09-01T00:00:00.000Z") + (index % 30) * 86_400_000).toISOString(),
    outcomeReason: null,
    ...overrides,
  };
}

// A spread that puts rows in every tab and every queue, including ties.
const rows = [];
for (let index = 0; index < 213; index += 1) rows.push(makeRow(index));
for (let index = 213; index < 253; index += 1) rows.push(makeRow(index, { status: "active" }));
for (let index = 253; index < 281; index += 1) rows.push(makeRow(index, { status: "ended_pending_check", checkAttempts: 0 }));
for (let index = 281; index < 296; index += 1) rows.push(makeRow(index, { status: "unsold" }));
for (let index = 296; index < 311; index += 1) rows.push(makeRow(index, { status: "ambiguous", reviewedBy: "SP" }));
for (let index = 311; index < 326; index += 1) rows.push(makeRow(index, { listingTitle: `CGC 9.8 graded slab number ${index}` }));
for (let index = 326; index < 341; index += 1) rows.push(makeRow(index, { listingTitle: `Complete set lot of volumes 1-10 number ${index}` }));
for (let index = 341; index < 356; index += 1) rows.push(makeRow(index, { matchConflicts: ["publisher mismatch"] }));
for (let index = 356; index < 371; index += 1) rows.push(makeRow(index, { buyingFormat: "FIXED_PRICE OFFER", status: "ambiguous" }));
// Deliberate sort-key ties: identical match score and identical last seen.
for (let index = 371; index < 391; index += 1) {
  rows.push(makeRow(index, { matchScore: 50, lastSeenAt: "2026-09-05T00:00:00.000Z" }));
}

console.log(`\nSynthetic dataset: ${rows.length} rows`);
const tabTotals = { attention: 0, watching: 0, finished: 0 };
for (const row of rows) tabTotals[outcomeView(row)] += 1;
console.log(`  attention ${tabTotals.attention} · watching ${tabTotals.watching} · finished ${tabTotals.finished}`);

console.log("\n1. Every row lands in exactly one tab");
const first = browseOutcomes({ rows, now: NOW });
check("tab counts cover the whole dataset",
  first.viewCounts.attention + first.viewCounts.watching + first.viewCounts.finished === rows.length,
  `${JSON.stringify(first.viewCounts)} vs ${rows.length}`);
check("counts are totals, not the size of one page",
  first.viewCounts.attention > first.pageRows.length,
  `attention ${first.viewCounts.attention}, page holds ${first.pageRows.length}`);
check("a reviewed row is finished whatever its status",
  outcomeView({ status: "ambiguous", reviewedBy: "SP", checkAttempts: 3 }) === "finished");
check("a never-checked ended listing is watching, not attention",
  outcomeView({ status: "ended_pending_check", reviewedBy: null, checkAttempts: 0 }) === "watching");
check("an ended listing that was checked is attention",
  outcomeView({ status: "ended_pending_check", reviewedBy: null, checkAttempts: 2 }) === "attention");

console.log("\n2. Walking the pages yields every matching row exactly once");
function traverse(options) {
  const seen = [];
  const firstPage = browseOutcomes({ ...options, rows, page: 1, now: NOW });
  for (let page = 1; page <= firstPage.pageCount; page += 1) {
    const result = browseOutcomes({ ...options, rows, page, now: NOW });
    seen.push(...result.pageRows.map((row) => row.id));
  }
  return { seen, meta: firstPage };
}

for (const view of ["attention", "watching", "finished"]) {
  for (const queue of view === "attention" ? OUTCOME_QUEUES : ["all"]) {
    for (const sort of ["priority", "match", "newest"]) {
      const { seen, meta } = traverse({ view, queue, sort });
      const unique = new Set(seen);
      const label = `${view}/${queue}/${sort}`;
      if (seen.length !== meta.total || unique.size !== meta.total) {
        check(`traversal of ${label} is complete and duplicate-free`, false,
          `walked ${seen.length}, unique ${unique.size}, total ${meta.total}`);
      } else {
        checks += 1;
        console.log(`  ok   traversal of ${label.padEnd(34)} ${String(meta.total).padStart(4)} rows over ${meta.pageCount} page(s)`);
      }
    }
  }
}

console.log("\n3. Ordering is deterministic across repeated requests");
const tied = rows.filter((row) => row.matchScore === 50 && outcomeView(row) === "attention");
check("the dataset really contains sort-key ties", tied.length >= 10, `${tied.length} tied rows`);
const runA = traverse({ view: "attention", queue: "all", sort: "match" }).seen;
const runB = traverse({ view: "attention", queue: "all", sort: "match" }).seen;
check("two identical traversals give the identical sequence", JSON.stringify(runA) === JSON.stringify(runB));
const shuffled = [...rows].reverse();
const fromShuffled = [];
const shuffledFirst = browseOutcomes({ rows: shuffled, view: "attention", queue: "all", sort: "match", page: 1, now: NOW });
for (let page = 1; page <= shuffledFirst.pageCount; page += 1) {
  fromShuffled.push(...browseOutcomes({ rows: shuffled, view: "attention", queue: "all", sort: "match", page, now: NOW }).pageRows.map((row) => row.id));
}
check("input order does not change the output order", JSON.stringify(runA) === JSON.stringify(fromShuffled));
const sortedTwice = sortOutcomes(rows, "priority", NOW).map((row) => row.id);
check("sortOutcomes is itself stable", JSON.stringify(sortedTwice) === JSON.stringify(sortOutcomes([...rows].reverse(), "priority", NOW).map((row) => row.id)));

console.log("\n4. Page boundaries");
const attention = browseOutcomes({ rows, view: "attention", queue: "all", page: 1, now: NOW });
check("page 1 reports a 1-based first index", attention.firstIndex === 1, `got ${attention.firstIndex}`);
check("page 1 last index matches the rows served", attention.lastIndex === attention.pageRows.length);
check("a full page holds exactly the page size", attention.pageRows.length === attention.pageSize, `${attention.pageRows.length} vs ${attention.pageSize}`);
const lastPage = browseOutcomes({ rows, view: "attention", queue: "all", page: attention.pageCount, now: NOW });
check("the last page ends on the total", lastPage.lastIndex === attention.total, `${lastPage.lastIndex} vs ${attention.total}`);
check("the last page is not empty", lastPage.pageRows.length > 0);
const beyond = browseOutcomes({ rows, view: "attention", queue: "all", page: 9999, now: NOW });
check("a page past the end clamps to the last page", beyond.page === attention.pageCount, `got ${beyond.page}`);
check("clamping still returns rows", beyond.pageRows.length > 0);
const beforeStart = browseOutcomes({ rows, view: "attention", queue: "all", page: -5, now: NOW });
check("a page before the start clamps to 1", beforeStart.page === 1);
const exact = browseOutcomes({ rows: rows.slice(0, 0), view: "attention", queue: "all", now: NOW });
check("an empty dataset reports one page and no rows", exact.pageCount === 1 && exact.pageRows.length === 0 && exact.total === 0);
check("an empty dataset reports zero indices", exact.firstIndex === 0 && exact.lastIndex === 0);
const pageSizeOne = traverse({ view: "attention", queue: "all", sort: "priority" });
const byOnes = [];
const onesFirst = browseOutcomes({ rows, view: "attention", queue: "all", pageSize: 1, page: 1, now: NOW });
for (let page = 1; page <= onesFirst.pageCount; page += 1) {
  byOnes.push(...browseOutcomes({ rows, view: "attention", queue: "all", pageSize: 1, page, now: NOW }).pageRows.map((row) => row.id));
}
check("a page size of one walks the same sequence", JSON.stringify(byOnes) === JSON.stringify(pageSizeOne.seen), `${byOnes.length} vs ${pageSizeOne.seen.length}`);

console.log("\n5. A focused outcome is always reachable");
const attentionAll = browseOutcomes({ rows, view: "attention", queue: "all", page: 1, now: NOW });
const deepRow = sortOutcomes(rows.filter((row) => outcomeView(row) === "attention"), "priority", NOW)[attentionAll.total - 1];
check("the test target really is on the last page",
  !attentionAll.pageRows.some((row) => row.id === deepRow.id) && attentionAll.pageCount > 1);
const focused = browseOutcomes({ rows, view: "attention", queue: "all", page: 1, focusId: deepRow.id, now: NOW });
check("the focused row is on the page served", focused.pageRows.some((row) => row.id === deepRow.id), `served page ${focused.page}`);
check("serving it is reported as a redirect", focused.focusRedirected);
check("the focused row appears once", focused.pageRows.filter((row) => row.id === deepRow.id).length === 1);

const watchingRow = rows.find((row) => outcomeView(row) === "watching");
const crossView = browseOutcomes({ rows, view: "attention", queue: "worth_checking", focusId: watchingRow.id, now: NOW });
check("a focus in another tab switches tab", crossView.view === "watching", `got ${crossView.view}`);
check("and is present on the page served", crossView.pageRows.some((row) => row.id === watchingRow.id));

const gradedRow = rows.find((row) => /CGC/.test(row.listingTitle) && outcomeView(row) === "attention");
const crossQueue = browseOutcomes({ rows, view: "attention", queue: "worth_checking", focusId: gradedRow.id, now: NOW });
check("a focus outside the chosen queue widens the queue", crossQueue.queue === "all", `got ${crossQueue.queue}`);
check("and is present on the page served", crossQueue.pageRows.some((row) => row.id === gradedRow.id));

const missing = browseOutcomes({ rows, view: "attention", focusId: "does-not-exist", now: NOW });
check("a focus id matching nothing is reported, not silently dropped", missing.focusMissing);
check("a missing focus still serves a normal page", missing.pageRows.length > 0 && !missing.focusRedirected);

console.log("\n6. Search narrows without losing rows");
const searched = traverse({ view: "attention", queue: "all", search: "graded slab" });
check("search finds the graded listings", searched.meta.total > 0, `${searched.meta.total} matches`);
check("search traversal is complete and duplicate-free",
  searched.seen.length === searched.meta.total && new Set(searched.seen).size === searched.meta.total);
check("every search result really matches",
  searched.seen.every((id) => /graded slab/i.test(rows.find((row) => row.id === id).listingTitle)));
const byExternalId = browseOutcomes({ rows, view: "attention", queue: "all", search: rows[0].externalId, now: NOW });
check("search matches an item number", byExternalId.total >= 1);
const byEdition = browseOutcomes({ rows, view: "attention", queue: "all", search: "Series 3", now: NOW });
check("search matches an edition label", byEdition.total >= 1);
const noMatch = browseOutcomes({ rows, view: "attention", queue: "all", search: "zzzz-no-such-listing", now: NOW });
check("a search matching nothing gives a clean empty state", noMatch.total === 0 && noMatch.pageRows.length === 0 && noMatch.pageCount === 1);

console.log("\n7. Queue counts describe the filtered set honestly");
const counted = browseOutcomes({ rows, view: "attention", queue: "all", now: NOW });
check("the all-queue count equals the tab total", counted.queueCounts.all === counted.viewCounts.attention,
  `${counted.queueCounts.all} vs ${counted.viewCounts.attention}`);
check("worth_checking and parked partition the tab",
  counted.queueCounts.worth_checking + counted.queueCounts.parked === counted.viewCounts.attention,
  `${counted.queueCounts.worth_checking} + ${counted.queueCounts.parked} vs ${counted.viewCounts.attention}`);
for (const queue of OUTCOME_QUEUES) {
  const result = browseOutcomes({ rows, view: "attention", queue, now: NOW });
  if (result.total !== counted.queueCounts[queue]) {
    check(`the ${queue} count matches what that queue serves`, false, `${counted.queueCounts[queue]} vs ${result.total}`);
  }
}
check("every queue count matches the rows that queue serves", true);
const searchedCounts = browseOutcomes({ rows, view: "attention", queue: "all", search: "graded slab", now: NOW });
check("queue counts follow the search", searchedCounts.queueCounts.all === searchedCounts.total);

console.log("\n8. Query parameters are validated");
check("an unknown view falls back to attention", normaliseView("nonsense") === "attention");
check("a known view is kept", normaliseView("finished") === "finished");
check("an unknown queue falls back to worth_checking", normaliseQueue("nonsense") === "worth_checking");
check("an unknown sort falls back to priority", normaliseSort("nonsense") === "priority");
check("a non-numeric page falls back to 1", normalisePage("abc") === 1);
check("a zero page falls back to 1", normalisePage("0") === 1);
check("a negative page falls back to 1", normalisePage("-3") === 1);
check("a fractional page is floored", normalisePage("4.7") === 4);
check("a valid page is kept", normalisePage("12") === 12);

console.log(`\n${failures ? "FAILED" : "PASSED"}: ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
