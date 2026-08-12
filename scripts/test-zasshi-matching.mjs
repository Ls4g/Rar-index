// Standalone check for magazine-issue matching. Run with:
//   node --experimental-strip-types scripts/test-zasshi-matching.mjs
//
// Imports the real shipped modules, so every rule under test is the rule
// that ships. Two things it has to establish:
//
//   1. A magazine listing resolves to the right issue, including the
//      combined-issue case where the cover prints "4・5" and the Media Arts
//      Database records only one of the two numbers.
//   2. Book matching is untouched. The live queue holds 2,385 leads and 99
//      of them contain the phrase "Shonen Jump" while being English
//      paperbacks. If the new magazine rules push any of those into
//      conflict, Scout gets worse for books, which is the exact outcome
//      this work is supposed to avoid.
//
// Per AGENTS.md this narrows what a human looks at and nothing more: no
// score here verifies a sale or a match.
import fs from "node:fs";
import { assessEditionMatch } from "../lib/editionMatch.ts";
import { parseIssueReference, namesAnIssue } from "../lib/editionMatch.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

// The One Piece debut, as it now sits in the review queue.
const debut = {
  title: "週刊少年ジャンプ",
  series: "Weekly Shonen Jump",
  volume_number: "1997年34号",
  language: "Japanese",
  isbn_13: null,
  publisher: "集英社",
  collectible_type: "zasshi",
  issue_year: 1997,
  issue_number_label: "34",
  cumulative_issue_no: 1458,
};
const listing = (title) => ({ title, series: null, volume_number: null, language: null, isbn_13: null, publisher: null });

console.log("\n--- reading an issue out of a listing title ---");
const cases = [
  ["週刊少年ジャンプ 1997年34号", 1997, [34]],
  ["週刊少年ジャンプ 1997年 34号 ONE PIECE 新連載", 1997, [34]],
  ["Weekly Shonen Jump 1997 No. 34", 1997, [34]],
  ["Weekly Shonen Jump 1997 #34 One Piece", 1997, [34]],
  ["Shonen Jump Issue 34 1997 One Piece first appearance", 1997, [34]],
  ["週刊少年ジャンプ 1998年4・5合併号", 1998, [4, 5]],
  ["Weekly Shonen Jump 1998 No. 4-5", 1998, [4, 5]],
  ["週刊少年ジャンプ 通巻1458", null, []],
];
for (const [title, year, numbers] of cases) {
  const ref = parseIssueReference(title);
  const ok = ref.year === year && JSON.stringify(ref.issueNumbers) === JSON.stringify(numbers);
  check(`"${title.slice(0, 44)}"`, ok, `got year=${ref.year} issues=[${ref.issueNumbers}]`);
}
check("通巻 is read when present", parseIssueReference("週刊少年ジャンプ 通巻1458").cumulative === 1458);

console.log("\n--- an issue number alone is not a magazine ---");
// Ten real leads read "Vol 1 Issue 1", all of them tankobon.
for (const title of [
  "Demon Slayer: Kimetsu no Yaiba Vol 1 Issue 1 TPB English Koyoharu Gotouge",
  "Dragon Ball Z Vol. 1 Issue 1 Softcover English Manga Toriyama Goku",
  "Akira Vol. 1 Issue #1 Manga Softcover English Black & White by Katsuhiro Otomo",
]) {
  check(`rejected: "${title.slice(0, 46)}"`, !namesAnIssue(parseIssueReference(title)) || parseIssueReference(title).looksLikeBook);
}

console.log("\n--- scoring against the One Piece debut issue ---");
for (const [title, band] of [
  ["週刊少年ジャンプ 1997年34号 ONE PIECE 新連載号", "strong"],
  ["Weekly Shonen Jump 1997 No. 34 One Piece first appearance", "strong"],
  ["週刊少年ジャンプ 1997年35号", "conflict"],
  ["週刊少年ジャンプ 1998年34号", "conflict"],
]) {
  const result = assessEditionMatch(debut, listing(title));
  check(`${band.padEnd(8)} "${title.slice(0, 42)}"`, result.confidence === band, `got ${result.confidence} (${result.score}) ${result.conflicts.join("; ")}`);
}

const vague = assessEditionMatch(debut, listing("Shonen Jump 1997 One Piece 1st appearance!!"));
check("a listing that names no issue stays below strong", vague.confidence !== "strong", `got ${vague.confidence} (${vague.score})`);

console.log("\n--- combined issues sold under either half ---");
const combined = { ...debut, issue_year: 1998, issue_number_label: "5", cumulative_issue_no: 1471, volume_number: "1998年5号" };
for (const title of ["週刊少年ジャンプ 1998年4・5合併号", "週刊少年ジャンプ 1998年5号", "Weekly Shonen Jump 1998 No. 4-5"]) {
  const r = assessEditionMatch(combined, listing(title));
  check(`matches "${title.slice(0, 40)}"`, r.confidence === "strong" || r.confidence === "partial", `got ${r.confidence} (${r.score})`);
}

console.log("\n--- a book listing never matches a magazine ---");
for (const title of [
  "Hunter X Hunter, Vol. 01 Paperback Yoshihiro Togashi Viz Media Shonen Jump",
  "One Piece Manga Vol 1-4 Shonen Jump English First Print Viz Media Eiichiro Oda",
  "Demon Slayer Vol 1 Viz Media 2018 Shonen Jump Book",
]) {
  const r = assessEditionMatch(debut, listing(title));
  check(`rejected: "${title.slice(0, 46)}"`, r.confidence === "conflict", `got ${r.confidence} (${r.score})`);
}

console.log("\n--- and a magazine listing never matches a book ---");
const book = {
  title: "ONE PIECE 1", series: "One Piece", volume_number: "1", language: "Japanese",
  isbn_13: "9784088725093", publisher: "集英社", collectible_type: "tankobon",
};
const crossed = assessEditionMatch(book, listing("週刊少年ジャンプ 1997年34号 ONE PIECE 新連載"));
check("Jump issue does not match One Piece Vol. 1", crossed.confidence === "conflict", `got ${crossed.confidence} (${crossed.score})`);

console.log("\n--- regression: the real lead queue ---");
// Scored against a book target, as they are today. The only new rule that
// can touch a book is the magazine-issue conflict, so the test is how many
// real listings now trip it.
const leadsFile = new URL("./fixtures/scout-lead-titles.json", import.meta.url);
if (!fs.existsSync(leadsFile)) {
  console.log("  SKIP  no lead fixture present (scripts/fixtures/scout-lead-titles.json)");
} else {
  const titles = JSON.parse(fs.readFileSync(leadsFile, "utf8"));
  const tripped = titles.filter((t) => {
    const r = assessEditionMatch(book, listing(t));
    return r.conflicts.includes("listing names a magazine issue, not this book");
  });
  console.log(`  ${titles.length} real lead titles scored against a book target`);
  console.log(`  ${tripped.length} newly conflict as magazine issues`);
  for (const t of tripped.slice(0, 15)) console.log(`      ${t.slice(0, 88)}`);
  const jumpTitles = titles.filter((t) => /shou?nen\s*jump/i.test(t));
  const jumpTripped = jumpTitles.filter((t) => assessEditionMatch(book, listing(t)).conflicts.includes("listing names a magazine issue, not this book"));
  check(`none of the ${jumpTitles.length} "Shonen Jump" book listings are misread as magazines`, jumpTripped.length === 0,
    jumpTripped.slice(0, 5).join("\n        "));
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
