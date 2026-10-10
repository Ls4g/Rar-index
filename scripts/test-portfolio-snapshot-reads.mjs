import assert from "node:assert/strict";
import { createPortfolioSnapshot } from "../lib/portfolioSnapshot.ts";
import { readCompleteRows } from "../lib/readCompleteRows.ts";

const holding = { id: "holding", edition_id: "edition", quantity: 1, purchase_price: 10, purchase_currency: "GBP", purchase_date: "2026-09-01", edition: { id: "edition", printing_of_edition_id: null } };
function database(failTable, empty = false) {
  const state = { writes: 0 };
  return { state, from(table) {
    let insert = false;
    const result = (single = false) => {
      if (table === failTable) return { data: null, error: { message: "offline" } };
      if (insert) { state.writes++; return { data: { id: "snapshot" }, error: null }; }
      const data = table === "portfolio_holdings" && !empty ? [holding] : [];
      return { data: single ? null : data, error: null };
    };
    const q = { select() { return q; }, eq() { return q; }, in() { return q; }, order() { return q; }, limit() { return q; },
      range() { return Promise.resolve(result()); }, maybeSingle() { return Promise.resolve(result(true)); },
      insert() { insert = true; return q; }, single() { return Promise.resolve(result(true)); } };
    return q;
  }};
}
for (const table of ["portfolio_holdings", "manga_editions", "price_observations", "exchange_rates", "portfolio_snapshots"]) {
  const db = database(table);
  await assert.rejects(createPortfolioSnapshot(db, "owner"), /offline/);
  assert.equal(db.state.writes, 0, `${table} failure must not save a snapshot`);
}
const empty = database(null, true);
await createPortfolioSnapshot(empty, "owner");
assert.equal(empty.state.writes, 1, "a genuinely empty portfolio may have a snapshot");
const rows = Array.from({ length: 1201 }, (_, id) => ({ id }));
const read = await readCompleteRows("test", (from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }));
assert.deepEqual(read, rows, "all rows beyond a server's normal cap are included");
await assert.rejects(readCompleteRows("test", (from, to) => Promise.resolve(from ? { data: null, error: { message: "later page failed" } } : { data: rows.slice(from, to + 1), error: null })), /later page failed/);
console.log("Snapshot reads: essential failures prevent writes, genuine empty portfolios and complete pagination passed.");
