import assert from "node:assert/strict";
import { searchShueishaTitleCatalogue } from "../lib/catalogueSources.ts";
import { backlogTargetToDiscoveryTarget, planBacklogRun } from "../lib/catalogueDiscovery.ts";
import { candidateMatchesDiscoveryTarget } from "../lib/catalogueCurator.ts";

const searchPage = (entries) => `<script>var ssd = ${JSON.stringify({ series_count: entries.length, datas: entries })};</script>`;
const seriesPage = (name, id, isbn, itemName, label) => `<script>var ssd = ${JSON.stringify({
  data: { series_data: { series_name: name, series_id: id, main_label_name: label },
    item_datas: [{ isbn, item_name: itemName, view_volume_number: "1" }] },
})};</script>`;
const htmlRecord = (isbn, title, date) => `<h1>${title}</h1><p>ISBN：${isbn}</p><p>${date}発売</p>`;
const oldFetch = globalThis.fetch;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  let html = "";
  if (url.searchParams.has("titleauthor")) html = searchPage([
    { series_name: "呪術廻戦≡", series_id: 3 },
    { series_name: "呪術廻戦", series_id: 2 },
    { series_name: "呪術廻戦", series_id: 1 },
  ]);
  else if (url.searchParams.get("seriesid") === "1") html = seriesPage("呪術廻戦", 1, "978-4-08-881516-9", "呪術廻戦／1", "ジャンプコミックス");
  else if (url.searchParams.get("seriesid") === "2") html = seriesPage("呪術廻戦", 2, "978-4-08-115285-8", "呪術廻戦 1 両面宿儺", "集英社リミックス");
  else if (url.searchParams.get("seriesid") === "3") throw new Error("A sequel must not be opened as the original series.");
  else if (url.searchParams.has("isbn")) {
    const isbn = url.searchParams.get("isbn").replaceAll("-", "");
    html = isbn === "9784088815169"
      ? htmlRecord("978-4-08-881516-9", "呪術廻戦 1", "2018年7月4日")
      : htmlRecord("978-4-08-115285-8", "呪術廻戦 1 両面宿儺", "2026年1月9日");
  }
  return new Response(html, { status: 200 });
};

try {
  const candidates = await searchShueishaTitleCatalogue("呪術廻戦", 1);
  assert.deepEqual(candidates.map((candidate) => candidate.candidate_isbn_13), ["9784088815169", "9784081152858"]);
  assert.equal(candidates[0].candidate_release_date, "2018-07-04");
  assert.equal(candidates[0].candidate_volume_number, "1");
  assert.ok(candidates[0].source_record_url.includes("books.shueisha.co.jp/items/contents.html?isbn="));

  const backlog = {
    id: "j1", discovery_source: "staff_fast_track", external_id: "staff:j1",
    title_english: "Jujutsu Kaisen", title_romaji: null, title_native: null,
    series_key: "jujutsu kaisen", lane: "established", language: "Japanese",
    score: 100, series_status: null, reported_volume_count: null,
    next_missing_volume: 1, status: "watching", source_url: null,
    source_metadata: {}, last_checked_at: null, next_check_at: null,
    failure_count: 0, last_result: null,
  };
  const target = backlogTargetToDiscoveryTarget(backlog);
  assert.equal(target.query, "呪術廻戦");
  assert.equal(target.source, "shueisha_direct");
  assert.equal(target.isbn13, null);
  assert.equal(candidateMatchesDiscoveryTarget(candidates[0], target), true);
  assert.equal(candidateMatchesDiscoveryTarget(candidates[1], target), false);
  assert.equal(backlogTargetToDiscoveryTarget({ ...backlog, discovery_source: "anilist" }), null);
  assert.equal(backlogTargetToDiscoveryTarget({ ...backlog, discovery_source: "anilist", source_metadata: { expected_publisher: "Shueisha" } }).source, "shueisha_direct");
  const planningAdmin = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [
    backlog,
    { ...backlog, id: "j2", discovery_source: "anilist", series_key: "other", source_metadata: {} },
  ] }) }) }) }) }) };
  const planned = await planBacklogRun(planningAdmin);
  assert.deepEqual(planned.chosen.map((row) => row.id), ["j1"]);
  console.log("Shueisha title discovery guards passed.");
} finally {
  globalThis.fetch = oldFetch;
}
