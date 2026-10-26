import assert from "node:assert/strict";
import { canonicalKodanshaProductUrl, kodanshaAdjacentUrl, kodanshaRecordKind, parseKodanshaRecord } from "../lib/kodanshaRecord.ts";
import { backlogTargetToDiscoveryTarget, planBacklogRun } from "../lib/catalogueDiscovery.ts";
import { catalogueApprovalProblem } from "../lib/catalogueApprovalGuard.ts";
import { candidateMatchesDiscoveryTarget, cataloguePublisherMatches } from "../lib/catalogueCurator.ts";

const japanUrl = "https://www.kodansha.co.jp/comic/products/0000017064";
const usaUrl = "https://kodansha.us/series/the-seven-deadly-sins/volume-1/";
const japan = parseKodanshaRecord(`
  <meta property="og:title" content="『進撃の巨人（１）』（諫山　創）　製品詳細　講談社">
  <meta property="og:image" content="https://dvs-cover.kodansha.co.jp/0000017064/cover.jpg">
  <meta property="books:isbn" content="9784063842760" />
  <h4>紙版</h4><p>ISBN 9784063842760</p>`, japanUrl);
assert.equal(japan?.printIsbn13, "9784063842760");
assert.equal(japan?.title, "進撃の巨人（１）");
assert.equal(japan?.coverUrl, "https://dvs-cover.kodansha.co.jp/0000017064/cover.jpg");

const usa = parseKodanshaRecord(`
  <meta property="og:title" content="The Seven Deadly Sins 1 | Kodansha">
  <meta property="og:image" content="https://production.image.azuki.co/cover.webp">
  <p>Digital ISBN: 9781612629223</p><p>Print ISBN: 9781612629216</p>`, usaUrl);
assert.equal(usa?.printIsbn13, "9781612629216", "The digital ISBN must not be selected");
assert.equal(usa?.coverUrl, "https://production.image.azuki.co/cover.webp");
assert.equal(kodanshaRecordKind("https://www.kodansha.co.jp/products/search?keywords=foo"), null);
assert.equal(kodanshaRecordKind("https://evil.example/comic/products/0000017064"), null);
assert.equal(kodanshaRecordKind("http://www.kodansha.co.jp/comic/products/0000017064"), null);
assert.equal(canonicalKodanshaProductUrl("https://kc.kodansha.co.jp/product?item=0000006854"),
  "https://www.kodansha.co.jp/comic/products/0000006854");
assert.equal(kodanshaAdjacentUrl(`<a href="https://www.kodansha.co.jp/comic/products/0000017125"><span>次巻</span></a>`, "next"),
  "https://www.kodansha.co.jp/comic/products/0000017125");
assert.equal(cataloguePublisherMatches("講談社", "Kodansha"), true);

const backlog = {
  id: "test", discovery_source: "staff_fast_track", title_english: "Attack on Titan",
  title_romaji: null, title_native: "進撃の巨人", language: "Japanese",
  next_missing_volume: 1, source_url: japanUrl,
  source_metadata: { expected_publisher: "講談社", isbn_13: "9784063842760" },
  lane: "established",
};
const target = backlogTargetToDiscoveryTarget(backlog);
assert.equal(target?.source, "kodansha_direct");
assert.equal(target?.query, japanUrl);
assert.equal(target?.isbn13, "9784063842760");
assert.equal(backlogTargetToDiscoveryTarget({ ...backlog, source_url: null, source_metadata: {} }), null,
  "Unknown Japanese publishers must not be sent to Shueisha");
assert.equal(backlogTargetToDiscoveryTarget({ ...backlog, source_url: null,
  source_metadata: { expected_publisher: "講談社", isbn_13: "9784063842760" } })?.source, "openbd");

const gap = { ...backlog, id: "gap", discovery_source: "rar_catalogue", next_missing_volume: 2,
  source_url: null, source_metadata: {}, status: "watching", score: 1000,
  last_checked_at: null, next_check_at: null, failure_count: 0, last_result: null,
  series_key: "attack on titan" };
const planningAdmin = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [gap] }) }) }) }) }) };
const plan = await planBacklogRun(planningAdmin, [{ series: "Attack on Titan", language: "Japanese", publisher: "Kodansha" }],
  new Map([["attack on titan", new Map([[1, japanUrl]])]]));
assert.equal(plan.chosen.length, 1);
const neighborTarget = backlogTargetToDiscoveryTarget(plan.chosen[0]);
assert.equal(neighborTarget?.source, "kodansha_neighbor");
assert.equal(neighborTarget?.neighborDirection, "next");
const initialDTarget = backlogTargetToDiscoveryTarget({ ...gap, title_english: "Initial D", series_key: "initial d",
  source_metadata: { expected_publisher: "Kodansha", kodansha_neighbor_url: "https://kc.kodansha.co.jp/product?item=0000006854" } });
assert.equal(candidateMatchesDiscoveryTarget({
  candidate_title: "頭文字Ｄ（２）", candidate_volume_number: "2", candidate_publisher: "Kodansha",
  candidate_language: "Japanese", candidate_isbn_13: "9784063235838",
}, initialDTarget), true);

const officialCandidate = {
  candidate_title: "進撃の巨人（１）", candidate_publisher: "Kodansha", candidate_language: "Japanese",
  candidate_isbn_13: "9784063842760", candidate_volume_number: "1",
};
assert.equal(candidateMatchesDiscoveryTarget(officialCandidate, target), true);
const wrongVolume = { ...officialCandidate, candidate_title: "進撃の巨人（２）", candidate_volume_number: "2" };
assert.equal(candidateMatchesDiscoveryTarget(wrongVolume, target), false);

const conflict = catalogueApprovalProblem({
  external_id: japanUrl, source_record_url: japanUrl, candidate_kind: "edition_candidate",
  candidate_title: officialCandidate.candidate_title, candidate_series: "Attack on Titan",
  candidate_volume_number: "1", candidate_author: null, candidate_publisher: "Kodansha",
  candidate_language: "Japanese", candidate_isbn_13: "9784063842760",
  candidate_release_date: null,
  raw_payload: { official_isbn_conflict: {
    rar_target_isbn_13: "9784063842761", publisher_print_isbn_13: "9784063842760",
  } },
}, []);
assert.match(conflict, /Official publisher print ISBN/);

console.log("Kodansha official record, source routing, and ISBN conflict checks passed.");
