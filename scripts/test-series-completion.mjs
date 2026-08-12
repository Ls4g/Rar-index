import { buildSeriesProgress, volumeSortValue } from "../lib/seriesCompletion.ts";

let failures = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        expected ${e}\n        actual   ${a}`}`);
}

const vol = (id, series, volumeNumber, language = "English") => ({
  id, title: `${series} ${volumeNumber ?? ""}`.trim(), series, volumeNumber, language,
  coverImageUrl: null, coverStatus: null,
});

// --- volume ordering -------------------------------------------------------
check("plain number", volumeSortValue("3"), 3);
check("zero padded", volumeSortValue("01"), 1);
check("prefixed", volumeSortValue("Vol. 12"), 12);
check("decimal", volumeSortValue("3.5"), 3.5);
check("no number returns null", volumeSortValue("Omnibus"), null);
check("null input", volumeSortValue(null), null);

// --- grouping --------------------------------------------------------------
const catalogue = [
  vol("a", "Berserk", "3"), vol("b", "Berserk", "1"), vol("c", "Berserk", "2"),
  vol("d", "Akira", "1"), vol("e", "Akira", "2"),
  vol("f", "Berserk", "1", "Japanese"),
];
const progress = buildSeriesProgress(catalogue, ["b", "c", "d"]);

check("groups by series and language", progress.length, 3);
const berserkEn = progress.find(p => p.series === "Berserk" && p.language === "English");
check("counts tracked", berserkEn.tracked, 3);
check("counts owned", berserkEn.owned, 2);
check("orders volumes numerically", berserkEn.volumes.map(v => v.label), ["1", "2", "3"]);
check("marks ownership per volume", berserkEn.volumes.map(v => v.owned), [true, true, false]);

const berserkJp = progress.find(p => p.series === "Berserk" && p.language === "Japanese");
check("language is a separate series run", berserkJp.tracked, 1);
check("japanese copy not counted as owned", berserkJp.owned, 0);

check("most-owned series sorts first", progress[0].series, "Berserk");

// --- honesty guards --------------------------------------------------------
const partial = buildSeriesProgress([vol("x", "One Piece", "1")], ["x"]);
check("single tracked volume reports 1 of 1, not 1 of 100", [partial[0].owned, partial[0].tracked], [1, 1]);

const unnumbered = buildSeriesProgress([vol("y", "Akira", null), vol("z", "Akira", "1")], []);
check("unnumbered volumes sort last", unnumbered[0].volumes.map(v => v.label), ["1", "—"]);

const noSeries = buildSeriesProgress([{ id: "n", title: null, series: null, volumeNumber: "1", language: "English", coverImageUrl: null, coverStatus: null }], []);
check("rows with no series or title are skipped", noSeries.length, 0);

const setInput = buildSeriesProgress(catalogue, new Set(["b"]));
check("accepts a Set as well as an array", setInput.find(p => p.series === "Berserk" && p.language === "English").owned, 1);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
