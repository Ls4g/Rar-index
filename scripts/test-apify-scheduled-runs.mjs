// No paid Apify call and no database. Checks the per-edition scheduled run:
// failure codes, per-row drops, charge-overrun warning, time budget, bounded
// concurrency, and that the summary never carries a token.
// Run: node --experimental-strip-types scripts/test-apify-scheduled-runs.mjs
import assert from "node:assert/strict";
import {
  buildScheduledSoldSearchPlan,
  DAILY_BATCH_RESULTS_PER_SERIES,
  filterRequestedRows,
  MAX_DAILY_BATCH_CHARGE_USD,
  MAX_DAILY_BATCH_SERIES,
  queueDiscoveredListings,
  runScheduledEditionSearch,
  scheduledRunChargeCeilingUsd,
  soldSearchEditionRunUrl,
} from "../lib/apifySoldSearch.ts";
import {
  failedOutcome,
  formatLastError,
  problemFromError,
  runBounded,
  sanitiseDiagnostic,
  SoldSearchFailure,
  summariseRuns,
} from "../lib/apifyRunLog.ts";

const results = [];
async function check(label, fn) {
  try {
    await fn();
    results.push({ label, ok: true });
  } catch (error) {
    results.push({ label, ok: false, error: error.stack ?? String(error) });
  }
}

const makeEdition = (isbn, volume, series = "Attack on Titan", extra = {}) => ({
  id: `edition-${isbn}`, isbn_13: isbn, title: `${series}, Vol. ${volume}`, series,
  volume_number: String(volume), language: "English", publisher: "Kodansha", format: "Paperback",
  printing_number: null, edition_statement: null, variant_name: null, collectible_type: "tankobon", ...extra,
});
const EDITION = makeEdition("9781612620244", 1);
const plan = buildScheduledSoldSearchPlan([EDITION]);
const KEYWORD = plan.keywords[0];
const row = (itemId, extra = {}) => ({
  itemId, title: `Attack on Titan 1 manga ${itemId}`, url: `https://www.ebay.com/itm/${itemId}`,
  keyword: KEYWORD, endedAt: "2026-11-01", soldPrice: "9.99", soldCurrency: "USD", listingType: "buy_it_now", ...extra,
});

// A scripted Apify. Each step receives (url, options) and returns a Response.
function fakeApify(steps) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (/\/abort$/.test(String(url))) return Response.json({ data: { status: "ABORTED" } });
    const step = steps.shift();
    if (!step) throw new Error(`unexpected request ${url}`);
    return step(String(url), options);
  };
  return { fetch, calls };
}
async function withFetch(fake, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fake.fetch;
  try { return await fn(); } finally { globalThis.fetch = original; }
}
const started = () => Response.json({ data: { id: "run123" } });
const status = (value, extra = {}) => () => Response.json({ data: { status: value, usageTotalUsd: 0.0081, ...extra } });
const dataset = (rows) => () => Response.json(rows);
const farDeadline = () => Date.now() + 120_000;

await check("per-run charge ceilings never add up to more than the daily ceiling", () => {
  for (let runs = 1; runs <= MAX_DAILY_BATCH_SERIES; runs += 1) {
    const each = scheduledRunChargeCeilingUsd(runs);
    assert.ok(each > 0);
    assert.ok(each * runs <= MAX_DAILY_BATCH_CHARGE_USD + 1e-9, `${runs} runs x ${each}`);
  }
  assert.equal(scheduledRunChargeCeilingUsd(6), 0.0233);
  assert.equal(scheduledRunChargeCeilingUsd(1), MAX_DAILY_BATCH_CHARGE_USD);
  const url = new URL(soldSearchEditionRunUrl(0.0233));
  assert.equal(url.searchParams.get("maxTotalChargeUsd"), "0.0233");
  assert.equal(Number(url.searchParams.get("maxItems")), DAILY_BATCH_RESULTS_PER_SERIES, "one keyword, same results per keyword");
  assert.equal(url.searchParams.get("timeout"), "120");
  assert.equal(url.searchParams.get("restartOnError"), "false");
});

await check("a successful run returns its rows, cost and no warning", async () => {
  const fake = fakeApify([
    (url, options) => {
      assert.match(url, /\/actors\/oTtB3VgfuE9GtxQt2\/runs\?/);
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer secret-token");
      const input = JSON.parse(options.body);
      assert.deepEqual(input.keywords, [KEYWORD]);
      assert.equal(input.count, DAILY_BATCH_RESULTS_PER_SERIES);
      assert.equal(input.daysToScrape, 90);
      assert.equal(input.ebaySite, "ebay.com");
      return started();
    },
    (url) => { assert.match(url, /actor-runs\/run123\?waitForFinish=60$/); return status("SUCCEEDED")(); },
    (url) => { assert.match(url, /actor-runs\/run123\/dataset\/items\?limit=4$/); return dataset([row("100001"), row("100002")])(); },
    status("SUCCEEDED", { usageTotalUsd: 0.009 }),
  ]);
  const result = await withFetch(fake, () => runScheduledEditionSearch("secret-token", plan,
    { maxChargeUsd: 0.0233, deadlineAt: farDeadline() }));
  assert.equal(result.rows.length, 2);
  assert.equal(result.costUsd, 0.009, "the refreshed final cost is used");
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.dropCounts, {});
});

await check("rows with an unexpected keyword are dropped one by one; the rest are kept", async () => {
  const fake = fakeApify([started, status("SUCCEEDED"), dataset([
    row("100001"), row("100002", { keyword: "something else" }), { keyword: null, error: "no results" }, "junk", row("100003"),
  ]), status("SUCCEEDED")]);
  const result = await withFetch(fake, () => runScheduledEditionSearch("t", plan, { maxChargeUsd: 0.02, deadlineAt: farDeadline() }));
  assert.deepEqual(result.rows.map((item) => item.itemId), ["100001", "100003"]);
  assert.deepEqual(result.dropCounts, { unexpected_keyword: 2, invalid_row: 1 });
});

await check("a charge above the ceiling keeps the rows and records a warning", async () => {
  const fake = fakeApify([started, status("SUCCEEDED", { usageTotalUsd: 0.05 }), dataset([row("100001")]),
    status("SUCCEEDED", { usageTotalUsd: 0.05 })]);
  const result = await withFetch(fake, () => runScheduledEditionSearch("t", plan, { maxChargeUsd: 0.0233, deadlineAt: farDeadline() }));
  assert.equal(result.rows.length, 1);
  assert.equal(result.warnings[0].code, "charge_ceiling");
  assert.match(result.warnings[0].message, /0\.0500.*0\.0233/);
});

await check("every failure path throws a coded SoldSearchFailure", async () => {
  const cases = [
    ["start_http_error", [() => Response.json({ error: { type: "invalid-input", message: "Field input.keywords must have at most 6 items" } }, { status: 400 })], /HTTP 400.*at most 6 items/],
    ["no_run_id", [() => Response.json({ data: {} })], /no usable run id/],
    ["poll_http_error", [started, () => new Response("x", { status: 503 })], /HTTP 503/],
    ["actor_failed", [started, status("FAILED", { statusMessage: "Input is invalid token=abc123" })], /FAILED.*token=\[redacted\]/],
    ["actor_aborted", [started, status("ABORTED")], /ABORTED/],
    ["actor_timed_out", [started, status("TIMED-OUT")], /TIMED-OUT/],
    ["not_finished", [started, status("RUNNING"), status("RUNNING"), status("RUNNING")], /still RUNNING after 3/],
    ["dataset_http_error", [started, status("SUCCEEDED"), () => new Response("x", { status: 500 })], /HTTP 500/],
    ["invalid_dataset", [started, status("SUCCEEDED"), () => Response.json({ items: [] })], /not a list/],
  ];
  for (const [code, steps, message] of cases) {
    const fake = fakeApify([...steps]);
    await assert.rejects(
      withFetch(fake, () => runScheduledEditionSearch("t", plan, { maxChargeUsd: 0.02, deadlineAt: farDeadline() })),
      (error) => {
        assert.ok(error instanceof SoldSearchFailure, code);
        assert.equal(error.code, code);
        assert.match(error.message, message, code);
        assert.doesNotMatch(error.message, /abc123/);
        return true;
      },
    );
    if (code === "not_finished") assert.ok(fake.calls.some((call) => /\/abort$/.test(call.url)), "an abandoned run is aborted");
  }
});

await check("a run past RAR's deadline fails as time_budget and is aborted", async () => {
  const fake = fakeApify([started, status("RUNNING"), status("RUNNING"), status("RUNNING")]);
  let clock = Date.now();
  const deadlineAt = clock + 1_000;
  const now = () => { clock += 600; return clock; };
  await assert.rejects(withFetch(fake, () => runScheduledEditionSearch("t", plan, { maxChargeUsd: 0.02, deadlineAt, now })),
    (error) => error.code === "time_budget");
  assert.ok(fake.calls.some((call) => /\/abort$/.test(call.url)));
});

await check("a plan that is not exactly one edition is refused before any request", async () => {
  const fake = fakeApify([]);
  const two = buildScheduledSoldSearchPlan([EDITION, makeEdition("9781612620245", 2)]);
  await assert.rejects(withFetch(fake, () => runScheduledEditionSearch("t", two, { maxChargeUsd: 0.02, deadlineAt: farDeadline() })),
    (error) => error.code === "invalid_plan");
  assert.equal(fake.calls.length, 0);
});

await check("filterRequestedRows caps at the requested result count", () => {
  const { kept, dropCounts } = filterRequestedRows([row("1"), row("2"), row("3")], plan, 2);
  assert.equal(kept.length, 2);
  assert.deepEqual(dropCounts, { over_result_cap: 1 });
});

await check("diagnostics never carry tokens or URLs", () => {
  const text = sanitiseDiagnostic("Bearer apify_api_ABC123 failed at https://api.apify.com/v2/x?token=zzz key=abc apify_api_QQQ");
  assert.doesNotMatch(text, /ABC123|zzz|QQQ|api\.apify\.com|key=abc/);
  assert.ok(sanitiseDiagnostic("x".repeat(1000)).length <= 300);
  const line = formatLastError({ code: "actor_failed", message: "ended" }, [{ code: "charge_ceiling", message: "over" }]);
  assert.equal(line, "actor_failed: ended | warning charge_ceiling: over");
  assert.equal(problemFromError(Object.assign(new Error("x"), { name: "TimeoutError" }), true).code, "time_budget");
  assert.equal(problemFromError(Object.assign(new Error("x"), { name: "TimeoutError" }), false).code, "request_timeout");
  const generic = problemFromError(new Error("boom Bearer s3cret"));
  assert.equal(generic.code, "exception");
  assert.doesNotMatch(generic.message, /s3cret/);
});

await check("runBounded runs two at a time and isolates failures", async () => {
  let active = 0;
  let peak = 0;
  const items = ["a", "b", "c", "d", "e"];
  const out = await runBounded(items, { concurrency: 2, deadlineAt: Date.now() + 5_000, minStartMs: 0, graceMs: 0 },
    async (item) => {
      active += 1; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      if (item === "c") throw new Error("c broke");
      return `ok:${item}`;
    }, (item) => `timeout:${item}`, (item) => `failed:${item}`);
  assert.equal(peak, 2);
  assert.deepEqual(out, ["ok:a", "ok:b", "failed:c", "ok:d", "ok:e"]);
});

await check("runBounded never hangs: unstarted and overrunning items resolve as timed out", async () => {
  const seen = [];
  const t0 = Date.now();
  const out = await runBounded(["slow1", "slow2", "late"], { concurrency: 2, deadlineAt: Date.now() + 80, minStartMs: 50, graceMs: 20 },
    (item, signal) => new Promise((resolve) => {
      signal.addEventListener("abort", () => seen.push(`aborted:${item}`));
      setTimeout(() => resolve(`ok:${item}`), 10_000).unref?.();
    }), (item, startedRun) => `timeout:${item}:${startedRun}`, (item) => `failed:${item}`);
  assert.ok(Date.now() - t0 < 1_000, "resolved near the deadline, not after the slow work");
  assert.deepEqual(out, ["timeout:slow1:true", "timeout:slow2:true", "timeout:late:false"]);
  assert.deepEqual(seen.sort(), ["aborted:slow1", "aborted:slow2"]);
});

await check("queueing counts drops by code and does not insert an ambiguous printing", async () => {
  const variant = { ...EDITION, id: "variant", printing_number: 9, variant_name: "Gold Foil" };
  const isbnPlan = { keywords: ["9781612620244"], queryToIsbn: new Map([["9781612620244", "9781612620244"]]), titleTargets: new Map() };
  const inserted = [];
  const admin = { from: () => ({ upsert: (rows) => { inserted.push(...rows); return { select: async () => ({ data: rows.map((_, i) => ({ id: i })), error: null }) }; } }) };
  const base = { keyword: "9781612620244", endedAt: "2026-11-01", soldPrice: "5.00", soldCurrency: "USD" };
  const outcome = await queueDiscoveredListings(admin, [
    { ...base, itemId: "200001", title: "Attack on Titan 1 by Isayama", url: "https://www.ebay.com/itm/200001" },
    { ...base, itemId: "200002", title: "Attack on Titan 1 Gold Foil cover", url: "https://www.ebay.com/itm/200002" },
    { ...base, itemId: "200003", title: "Attack on Titan 1", url: "https://www.ebay.com/itm/999999999" },
    { ...base, itemId: "200004", title: "Attack on Titan 1", url: "https://www.ebay.com/itm/200004", soldPriceMax: "9.00" },
    { ...base, itemId: null, title: "Attack on Titan 1", url: "https://www.ebay.com/itm/200005" },
  ], [EDITION, variant], [], "source", isbnPlan);
  assert.equal(outcome.needsHuman, 1);
  assert.deepEqual(outcome.ambiguousItemIds, ["200001"]);
  assert.deepEqual(outcome.dropCounts, { id_url_mismatch: 1, price_range: 1, no_item_id: 1 });
  assert.equal(outcome.dropped, 3);
  assert.deepEqual(inserted.map((item) => item.external_id), ["200002"], "only the row whose title names the printing is queued");
  assert.equal(inserted[0].edition_id, "variant");
  assert.equal(inserted[0].status, "ended_pending_check");
  assert.ok(!Object.hasOwn(inserted[0], "sold_price"), "a lead, never a sale");
});

await check("the run summary is bounded and holds no secret", () => {
  const target = { editionId: "e1", isbn: "9781612620244", reason: "one_sale_short" };
  const ok = { ...failedOutcome(target, { code: "exception", message: "x" }), status: "succeeded", failure: null,
    found: 3, queued: 2, needsHuman: 1, costUsd: 0.0081, dropCounts: { price_range: 1 }, ambiguousItemIds: ["200001"] };
  const bad = failedOutcome({ ...target, editionId: "e2", isbn: "9781612620245" }, { code: "time_budget", message: "ran out" });
  const summary = summariseRuns([ok, bad]);
  assert.equal(summary.searched, 2);
  assert.equal(summary.succeeded, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.spentUsd, 0.0081);
  assert.deepEqual(summary.failureCodes, { time_budget: 1 });
  assert.deepEqual(summary.dropCounts, { price_range: 1 });
  assert.deepEqual(summary.ambiguousPrinting, [{ isbn: "9781612620244", item_id: "200001" }]);
  assert.equal(summary.runs[1].code, "time_budget");
  assert.doesNotMatch(JSON.stringify(summary), /Bearer|token/i);
});

for (const result of results) console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.label}${result.ok ? "" : `\n${result.error}`}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`${results.length - failed}/${results.length} scheduled-run checks passed.`);
if (failed) process.exit(1);
