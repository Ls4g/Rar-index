// Still-live watching, two-lane claiming, complete lead capture and the honest
// "sales confirmed" count.
//
//   node --experimental-strip-types scripts/test-watch-still-live.mjs
//
// Runs against a small in-memory stand-in for the Supabase query builder, so it
// needs no network, no credentials and no node_modules.
import assert from "node:assert/strict";
import {
  isDueForCheck, isFixedPriceFormat, MAX_WATCH_DAYS, STILL_LIVE_RECHECK_DAYS, stillLiveFollowUp,
} from "../lib/listingOutcome.ts";
import {
  CAPTURE_PAGE_SIZE, captureWatchedListings, promoteEndedListings, readWatchToSaleMetrics, runOutcomeChecks,
} from "../lib/watchToSale.ts";

let passed = 0;
function check(name, fn) { fn(); passed += 1; console.log(`  PASS  ${name}`); }
const DAY = 86_400_000;
const iso = (offsetDays) => new Date(Date.now() + offsetDays * DAY).toISOString();

// ------------------------------------------------------------ fake DB ----
function cmp(a, b) { return a === b ? 0 : a < b ? -1 : 1; }
function makeDb(tables) {
  const log = [];
  let nextId = 1;
  function parseOr(text) {
    // Supports the two filters the worker sends.
    const parts = []; let depth = 0; let current = "";
    for (const ch of text) {
      if (ch === "(") depth++; if (ch === ")") depth--;
      if (ch === "," && depth === 0) { parts.push(current); current = ""; } else current += ch;
    }
    parts.push(current);
    return parts.map((part) => {
      const and = part.match(/^and\((.*)\)$/);
      if (and) { const subs = and[1].split(",").map(parseAtom); return (row) => subs.every((sub) => sub(row)); }
      return parseAtom(part);
    });
  }
  function parseAtom(atom) {
    const [col, op, ...rest] = atom.split("."); const value = rest.join(".");
    if (op === "eq") return (row) => String(row[col]) === value;
    if (op === "is" && value === "null") return (row) => row[col] === null || row[col] === undefined;
    if (op === "lte") return (row) => row[col] !== null && row[col] !== undefined && row[col] <= value;
    if (op === "lt") return (row) => row[col] !== null && row[col] !== undefined && row[col] < value;
    throw new Error(`unsupported or atom ${atom}`);
  }
  function from(table) {
    const filters = []; let mode = "select"; let payload = null; let options = {}; let order = null; let limit = null; let range = null; let head = false; let returning = false;
    const rowsOf = () => tables[table] ?? (tables[table] = []);
    const run = () => {
      log.push({ table, mode, filters: filters.map((f) => f.desc), order, limit, range, size: Array.isArray(payload) ? payload.length : undefined });
      const matching = () => rowsOf().filter((row) => filters.every((f) => f.fn(row)));
      if (mode === "insert") { for (const row of [].concat(payload)) rowsOf().push({ id: `row-${nextId++}`, ...row }); return { data: null, error: null }; }
      if (mode === "upsert") {
        const inserted = [];
        for (const row of [].concat(payload)) {
          const keys = options.onConflict.split(",");
          if (rowsOf().some((existing) => keys.every((key) => existing[key] === row[key]))) continue;
          const created = { id: `row-${nextId++}`, status: "active", check_attempts: 0, next_check_at: null, reviewed_by: null, resulting_observation_id: null, ...row };
          rowsOf().push(created); inserted.push(created);
        }
        return { data: returning ? inserted : null, error: null };
      }
      if (mode === "update") {
        const hit = matching(); for (const row of hit) Object.assign(row, payload);
        return { data: returning ? hit.map((row) => ({ id: row.id })) : null, error: null };
      }
      let out = matching();
      if (order) out = [...out].sort((a, b) => {
        const av = a[order.col] ?? null; const bv = b[order.col] ?? null;
        if (av === null || bv === null) return av === bv ? 0 : (av === null) === order.nullsFirst ? -1 : 1;
        return order.ascending ? cmp(av, bv) : cmp(bv, av);
      });
      if (head) return { count: out.length, data: null, error: null };
      if (range) out = out.slice(range[0], range[1] + 1);
      if (limit !== null) out = out.slice(0, limit);
      return { data: out.map((row) => ({ ...row })), error: null };
    };
    const add = (desc, fn) => { filters.push({ desc, fn }); return q; };
    const q = {
      select(_cols, opts) { if (mode !== "select") returning = true; if (opts?.head) head = true; return q; },
      eq: (k, v) => add(`${k}=${v}`, (row) => row[k] === v),
      neq: (k, v) => add(`${k}!=${v}`, (row) => row[k] !== v),
      is: (k, v) => add(`${k} is ${v}`, (row) => (row[k] ?? null) === v),
      not: (k, op, v) => add(`${k} not ${op} ${v}`, (row) => (row[k] ?? null) !== v),
      in: (k, v) => add(`${k} in`, (row) => v.includes(row[k])),
      lt: (k, v) => add(`${k}<${v}`, (row) => row[k] !== null && row[k] < v),
      gt: (k, v) => add(`${k}>${v}`, (row) => row[k] !== null && row[k] > v),
      lte: (k, v) => add(`${k}<=${v}`, (row) => row[k] !== null && row[k] <= v),
      or: (text) => { const subs = parseOr(text); return add(`or(${text})`, (row) => subs.some((sub) => sub(row))); },
      order: (col, o = {}) => { order = { col, ascending: o.ascending !== false, nullsFirst: Boolean(o.nullsFirst) }; return q; },
      limit: (n) => { limit = n; return q; },
      range: (a, b) => { range = [a, b]; return q; },
      insert: (v) => { mode = "insert"; payload = v; return q; },
      upsert: (v, o) => { mode = "upsert"; payload = v; options = o; return q; },
      update: (v) => { mode = "update"; payload = v; return q; },
      maybeSingle: async () => { const r = run(); return { ...r, data: Array.isArray(r.data) ? r.data[0] ?? null : r.data }; },
      then: (a, b) => Promise.resolve(run()).then(a, b),
    };
    return q;
  }
  return {
    log, tables,
    from,
    rpc(name, args) {
      if (name === "reserve_outcome_checks") return Promise.resolve({ data: { granted: args.p_requested, spent: 0, reserved: args.p_requested, remaining: 2500 - args.p_requested, day: new Date().toISOString().slice(0, 10) }, error: null });
      return Promise.resolve({ error: null });
    },
  };
}

function outcome(overrides) {
  return {
    id: overrides.id, external_id: `v1|${overrides.id}|0`, marketplace: "EBAY_GB", listing_title: "Berserk Volume 1",
    status: "ended_pending_check", scheduled_end_at: null, next_check_at: null, check_attempts: 0,
    outcome_provider: null, buying_format: "FIXED_PRICE", first_seen_at: iso(-30), last_seen_at: iso(-10),
    reviewed_by: null, resulting_observation_id: null, ...overrides,
  };
}
const signalFor = (listingState, extra = {}) => ({
  signal: { provider: "eBay Trading GetItem", listingState, soldPrice: null, soldCurrency: null, soldAt: null, bidCount: null,
    buyingFormat: "FixedPriceItem", bestOfferAccepted: null, scheduledEndAt: iso(25), httpStatus: 200, detail: "", ...extra },
  httpStatus: 200, rawResponse: {},
});

// --------------------------------------------------------- pure rules ----
console.log("\n--- still-live cadence ---");
check("constants are a week and a year", () => { assert.equal(STILL_LIVE_RECHECK_DAYS, 7); assert.equal(MAX_WATCH_DAYS, 365); });
check("a listing seen live is rechecked in 7 days", () => {
  const now = new Date("2026-11-10T00:00:00Z");
  assert.deepEqual(stillLiveFollowUp("eBay Trading GetItem", "2026-06-01T00:00:00Z", now), { kind: "recheck", nextCheckAt: "2026-11-17T00:00:00.000Z" });
});
check("after 365 days of watching it is recorded as unknown, saying why", () => {
  const result = stillLiveFollowUp("eBay Trading GetItem", "2025-11-10T00:00:00Z", new Date("2026-11-10T00:00:00Z"));
  assert.equal(result.kind, "expired");
  assert.equal(result.classification.status, "ambiguous");
  assert.equal(result.classification.resolved, true);
  assert.match(result.classification.reason, /watched it for 365 days without it ending/);
});
check("an unreadable first-seen date never ends the watch early", () => assert.equal(stillLiveFollowUp("p", null).kind, "recheck"));
check("fixed-price formats recognised from Browse and Trading", () => {
  assert.ok(isFixedPriceFormat("FIXED_PRICE") && isFixedPriceFormat("FIXED_PRICE,BEST_OFFER") && isFixedPriceFormat("FixedPriceItem"));
  assert.ok(!isFixedPriceFormat("AUCTION") && !isFixedPriceFormat(null));
});
check("a fixed-price weekly recheck is due despite a future renewal date", () =>
  assert.ok(isDueForCheck({ status: "active", next_check_at: iso(-0.01), scheduled_end_at: iso(20), buying_format: "FIXED_PRICE" })));
check("an auction still waits for its own end", () =>
  assert.ok(!isDueForCheck({ status: "active", next_check_at: iso(-0.01), scheduled_end_at: iso(2), buying_format: "AUCTION" })));
check("a weekly recheck is not due early", () =>
  assert.ok(!isDueForCheck({ status: "active", next_check_at: iso(3), scheduled_end_at: null, buying_format: "FIXED_PRICE" })));

// ------------------------------------------------------- worker lanes ----
console.log("\n--- two-lane claiming ---");
{
  const db = makeDb({ listing_outcomes: [
    outcome({ id: "new-ended-1", next_check_at: iso(-0.1) }),
    outcome({ id: "new-ended-2", next_check_at: null }),
    ...Array.from({ length: 5 }, (_, i) => outcome({ id: `weekly-${i}`, status: "active", next_check_at: iso(-3 + i * 0.1) })),
  ], listing_outcome_checks: [] });
  const calls = [];
  const result = await runOutcomeChecks(db, 3, async (id) => { calls.push(id); return signalFor("active"); });
  check("first-time checks are claimed before any weekly recheck", () => {
    assert.deepEqual(calls.slice(0, 2).sort(), ["v1|new-ended-1|0", "v1|new-ended-2|0"]);
    assert.equal(calls.length, 3, "the reservation still bounds the run");
    assert.equal(calls[2], "v1|weekly-0|0", "the oldest-due weekly recheck fills the spare slot");
  });
  check("the weekly lane is asked only for spare capacity", () => {
    const weeklyRead = db.log.find((entry) => entry.mode === "select" && entry.filters.includes("status=active"));
    assert.equal(weeklyRead.limit, 1);
    assert.equal(result.stillLiveRechecks, 1);
  });
  check("a still-live answer stays watched with a 7-day next check", () => {
    const row = db.tables.listing_outcomes.find((r) => r.id === "new-ended-1");
    assert.equal(row.status, "active"); assert.equal(row.check_attempts, 0);
    const days = (Date.parse(row.next_check_at) - Date.now()) / DAY; assert.ok(days > 6.9 && days <= 7);
    assert.equal(result.stillActive, 3); assert.equal(result.exhausted, 0);
  });
  check("each check is audited, saying when it comes round again", () => {
    assert.equal(db.tables.listing_outcome_checks.length, 3);
    assert.ok(db.tables.listing_outcome_checks.every((c) => c.resulting_status === "active" && /again in 7 days/.test(c.detail)));
  });
}
{
  const db = makeDb({ listing_outcomes: [
    outcome({ id: "a", next_check_at: iso(-0.1) }), outcome({ id: "b", next_check_at: iso(-0.2) }),
    outcome({ id: "weekly", status: "active", next_check_at: iso(-5) }),
  ], listing_outcome_checks: [] });
  await runOutcomeChecks(db, 2, async () => signalFor("active"));
  check("a full first lane never reads the weekly lane", () =>
    assert.ok(!db.log.some((entry) => entry.mode === "select" && entry.filters.includes("status=active"))));
}
{
  const db = makeDb({ listing_outcomes: [
    outcome({ id: "old", status: "active", next_check_at: iso(-1), first_seen_at: iso(-400) }),
    outcome({ id: "retry", status: "ambiguous", check_attempts: 4, next_check_at: iso(-1) }),
    outcome({ id: "bo", next_check_at: iso(-1), buying_format: "FIXED_PRICE,BEST_OFFER" }),
    outcome({ id: "human", status: "active", next_check_at: iso(-1), reviewed_by: "SP" }),
  ], listing_outcome_checks: [] });
  const result = await runOutcomeChecks(db, 10, async (id) => {
    if (id.includes("old")) return signalFor("active");
    if (id.includes("bo")) return signalFor("completed_sold", { soldPrice: 20, soldCurrency: "GBP", soldAt: iso(-1), buyingFormat: "FixedPriceItem,BEST_OFFER" });
    return signalFor("unknown", { detail: "no conclusive sold quantity" });
  });
  const row = (id) => db.tables.listing_outcomes.find((r) => r.id === id);
  check("a year of watching ends as unknown with its reason", () => {
    assert.equal(row("old").status, "ambiguous"); assert.equal(row("old").next_check_at, null);
    assert.match(row("old").outcome_reason, /365 days without it ending/); assert.equal(result.watchExpired, 1);
  });
  check("a genuinely unknown outcome still exhausts into ambiguous", () => {
    assert.equal(row("retry").status, "ambiguous"); assert.equal(row("retry").next_check_at, null);
    assert.match(row("retry").outcome_reason, /never confirmed an outcome after 5 checks/);
  });
  check("Best Offer with no accepted price is unchanged: ambiguous, not rechecked", () => {
    assert.equal(row("bo").status, "ambiguous"); assert.match(row("bo").outcome_reason, /Best Offer listing: eBay did not disclose/);
    assert.equal(row("bo").next_check_at, null);
  });
  check("a human-reviewed row is never claimed", () => assert.equal(row("human").last_checked_at, undefined));
  check("automation never creates a sold candidate without a usable price", () =>
    assert.ok(!db.tables.listing_outcomes.some((r) => r.status === "sold_candidate")));
}
{
  const db = makeDb({ listing_outcomes: [
    outcome({ id: "weekly", status: "active", scheduled_end_at: null, next_check_at: iso(4), last_seen_at: iso(-9) }),
    outcome({ id: "unseen", status: "active", scheduled_end_at: null, next_check_at: null, last_seen_at: iso(-9) }),
  ] });
  await promoteEndedListings(db);
  check("unseen promotion leaves weekly-cadence rows in their slow lane", () => {
    assert.equal(db.tables.listing_outcomes.find((r) => r.id === "weekly").status, "active");
    assert.equal(db.tables.listing_outcomes.find((r) => r.id === "unseen").status, "ended_pending_check");
  });
}

// ------------------------------------------------------------ capture ----
console.log("\n--- capture every watched lead ---");
{
  const leads = Array.from({ length: 2345 }, (_, i) => ({
    id: `lead-${String(i).padStart(5, "0")}`, profile_id: i % 2 ? "p1" : "p2", source_id: "s", external_id: `v1|${100000000 + i}|0`,
    source_listing_url: `https://www.ebay.co.uk/itm/${100000000 + i}`, listing_title: `Book ${i}`, listing_price: 10, currency: "GBP",
    item_end_at: null, first_seen_at: iso(-20), last_seen_at: iso(-1), raw_payload: { item: { buyingOptions: ["FIXED_PRICE"] } },
    match_assessment: {}, review_status: i % 10 === 0 ? "dismissed" : i % 3 ? "watching" : "new",
  }));
  // The same listing seen by a second profile, and one reshuffled into the table out of id order.
  leads.push({ ...leads[1], id: "lead-99999", profile_id: "p2", last_seen_at: iso(-0.5) });
  leads.reverse();
  const db = makeDb({
    marketplace_search_profiles: [{ id: "p1", edition_id: "e1", is_active: true }, { id: "p2", edition_id: "e2", is_active: true }],
    scout_listing_leads: leads, listing_outcomes: [],
  });
  const expected = new Set(leads.filter((l) => l.review_status !== "dismissed").map((l) => l.external_id)).size;
  const first = await captureWatchedListings(db);
  check("every non-dismissed lead is captured, across pages, beyond the old 500", () => {
    assert.equal(db.tables.listing_outcomes.length, expected);
    assert.equal(first.captured, expected); assert.equal(first.truncated, false);
  });
  check("pages are ordered by id and bounded", () => {
    const reads = db.log.filter((e) => e.table === "scout_listing_leads");
    assert.equal(reads.length, Math.ceil(first.leadsRead / CAPTURE_PAGE_SIZE) + (first.leadsRead % CAPTURE_PAGE_SIZE ? 0 : 1));
    assert.ok(reads.every((e) => e.order?.col === "id" && e.range[1] - e.range[0] + 1 === CAPTURE_PAGE_SIZE));
  });
  check("inserts are batched rather than one call per lead", () =>
    assert.ok(db.log.filter((e) => e.mode === "upsert").length <= Math.ceil(first.leadsRead / 200) + 1));
  check("a duplicate sighting moves last_seen_at forward only", () => {
    const row = db.tables.listing_outcomes.find((r) => r.external_id === leads.find((l) => l.id === "lead-99999").external_id);
    assert.equal(row.last_seen_at, leads.find((l) => l.id === "lead-99999").last_seen_at);
  });
  const second = await captureWatchedListings(db);
  check("a second run captures nothing new and rewrites no snapshot", () => {
    assert.equal(second.captured, 0); assert.equal(db.tables.listing_outcomes.length, expected);
  });
  const capped = await captureWatchedListings(makeDb({ marketplace_search_profiles: db.tables.marketplace_search_profiles, scout_listing_leads: leads, listing_outcomes: [] }), 1);
  check("a page cap is reported as truncated, never silent", () => { assert.equal(capped.truncated, true); assert.equal(capped.leadsRead, CAPTURE_PAGE_SIZE); });
}

// -------------------------------------------------------------- count ----
console.log("\n--- honest sales count ---");
{
  const db = makeDb({ listing_outcomes: [
    outcome({ id: "sale", status: "review_complete", resulting_observation_id: "obs-1", reviewed_by: "SP" }),
    outcome({ id: "removed-1", status: "review_complete", reviewed_by: "SP" }),
    outcome({ id: "removed-2", status: "review_complete", reviewed_by: "SP" }),
    outcome({ id: "live", status: "active" }),
  ] });
  const metrics = await readWatchToSaleMetrics(db);
  check("sales confirmed counts only rows that produced a sale", () => assert.equal(metrics.watch_confirmed_sales, 1));
  check("removed-from-queue rows are counted separately", () => assert.equal(metrics.watch_dismissed, 2));
  check("stored data is unchanged by reading metrics", () => assert.equal(db.tables.listing_outcomes.filter((r) => r.status === "review_complete").length, 3));
}

console.log(`\n${passed} checks passed`);
