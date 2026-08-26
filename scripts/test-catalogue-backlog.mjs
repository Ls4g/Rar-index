// Catalogue Curator fair-scheduling tests. Run with:
//   node --experimental-strip-types scripts/test-catalogue-backlog.mjs
//
// The bug these exist for: the old planner sorted by lib/prioritySeries.ts's
// own index, One Piece is index 0, the run took four targets, and the live
// review queue ended up holding One Piece Volume 19 and nothing else. Every
// case below uses real title shapes rather than "series A / series B", because
// the failure was specifically about One Piece.
import {
  describeRunFairness,
  isDue,
  MAX_PER_SERIES_PER_RUN,
  nextCheckAfterFailure,
  nextVolumeToResearch,
  normaliseSeriesKey,
  planRun,
  TARGETS_PER_RUN,
} from "../lib/catalogueBacklog.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

let seq = 0;
function target(overrides = {}) {
  seq += 1;
  return {
    id: `t${seq}`,
    discovery_source: "anilist",
    external_id: `a${seq}`,
    title_english: null, title_romaji: null, title_native: null,
    series_key: "one piece",
    lane: "series_gap",
    language: "English",
    score: 100,
    series_status: "RELEASING",
    reported_volume_count: null,
    next_missing_volume: null,
    status: "researchable",
    source_url: null,
    last_checked_at: null,
    next_check_at: null,
    failure_count: 0,
    last_result: null,
    ...overrides,
  };
}

console.log("\n--- One Piece cannot take the run ---");
// The exact shape that produced the bug: a huge backlog of One Piece gaps,
// each scoring higher than anything else.
const onePieceFlood = Array.from({ length: 30 }, (_, index) => target({
  series_key: "one piece", lane: "series_gap", next_missing_volume: index + 2, score: 999,
}));
const others = [
  target({ series_key: "kagurabachi", lane: "series_gap", next_missing_volume: 2, score: 40 }),
  target({ series_key: "hunter x hunter", lane: "series_gap", next_missing_volume: 3, score: 60 }),
  target({ series_key: "chainsaw man", lane: "established", next_missing_volume: null, score: 330 }),
  target({ series_key: "sakamoto days", lane: "rising", next_missing_volume: null, score: 88 }),
  target({ series_key: "witchriv", lane: "new_release", next_missing_volume: null, score: 12 }),
];
const run = planRun([...onePieceFlood, ...others]);
const onePieceCount = run.filter((item) => item.series_key === "one piece").length;
check(`One Piece gets at most ${MAX_PER_SERIES_PER_RUN} of ${run.length} slots`, onePieceCount <= MAX_PER_SERIES_PER_RUN, `got ${onePieceCount}`);
check("a second series gets a slot in the same run", run.some((item) => item.series_key !== "one piece"));

const fairness = describeRunFairness(run);
check("at least five distinct series when the backlog allows", fairness.meetsDistinctSeriesGoal, JSON.stringify(fairness));
check("more than one lane runs", fairness.distinctLanes > 1, JSON.stringify(fairness.perLane));
check(`run is capped at ${TARGETS_PER_RUN}`, run.length <= TARGETS_PER_RUN, `got ${run.length}`);

console.log("\n--- a One-Piece-only backlog does not overrun the cap ---");
const onlyOnePiece = planRun(onePieceFlood);
check("a single-series backlog still respects the per-series cap", onlyOnePiece.length <= MAX_PER_SERIES_PER_RUN, `got ${onlyOnePiece.length}`);

console.log("\n--- Kagurabachi: the next gap ---");
// RAR holds Kagurabachi Vol. 1 in English. AniList reports volumes: null for
// every RELEASING series, so nothing tells RAR that Vol. 2 exists -- it is a
// thing to look for, and Open Library either has an exact record or it does
// not.
const kagurabachi = nextVolumeToResearch([1], null);
check("Kagurabachi with only Vol. 1 researches Vol. 2", kagurabachi.volume === 2 && !kagurabachi.caughtUp, JSON.stringify(kagurabachi));

const kagurabachiGap = nextVolumeToResearch([1, 3], null);
check("a hole is filled before the end is extended", kagurabachiGap.volume === 2, JSON.stringify(kagurabachiGap));

console.log("\n--- caught up, and never inventing a volume ---");
const finished = nextVolumeToResearch([1, 2, 3], 3);
check("a series held to its reported end is caught up", finished.volume === null && finished.caughtUp, JSON.stringify(finished));
const ongoing = nextVolumeToResearch([1, 2, 3], null);
check("with no reported count the next volume is researched, not assumed", ongoing.volume === 4 && !ongoing.caughtUp);
const empty = nextVolumeToResearch([], null);
check("a series RAR holds nothing of starts at Vol. 1", empty.volume === 1);

console.log("\n--- backoff ---");
check("a caught-up target is never due", !isDue({ status: "caught_up", next_check_at: null }));
check("a blocked target is never due", !isDue({ status: "blocked", next_check_at: null }));
check("a published target is never due", !isDue({ status: "published", next_check_at: null }));
check("a staged target is never due", !isDue({ status: "staged", next_check_at: null }));
check("a researchable target with no schedule is due", isDue({ status: "researchable", next_check_at: null }));
const soon = new Date(Date.now() + 3_600_000).toISOString();
check("a target scheduled for later is not due", !isDue({ status: "researchable", next_check_at: soon }));
check("failures back off further each time", new Date(nextCheckAfterFailure(3)) > new Date(nextCheckAfterFailure(0)));

console.log("\n--- targets not yet due are excluded ---");
const notDue = planRun([
  target({ series_key: "one piece", next_check_at: soon }),
  target({ series_key: "berserk", next_check_at: null, lane: "established" }),
]);
check("only due targets are planned", notDue.length === 1 && notDue[0].series_key === "berserk", JSON.stringify(notDue.map((item) => item.series_key)));

console.log("\n--- series keys ---");
check("casing inconsistency folds together", normaliseSeriesKey("ONE PIECE") === normaliseSeriesKey("One Piece"));
check("Hunter x Hunter folds its multiplication sign", normaliseSeriesKey("Hunter × Hunter") === normaliseSeriesKey("Hunter x Hunter"));
check("a volume suffix is not part of the series", normaliseSeriesKey("Kagurabachi Vol. 2") === normaliseSeriesKey("Kagurabachi"));

console.log("\n--- never-checked targets go first ---");
const mixed = planRun([
  target({ series_key: "naruto", lane: "established", last_checked_at: new Date().toISOString(), score: 900 }),
  target({ series_key: "berserk", lane: "established", last_checked_at: null, score: 10 }),
]);
check("a title never looked at outranks a high-scoring one already checked", mixed[0].series_key === "berserk", JSON.stringify(mixed.map((item) => item.series_key)));

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
