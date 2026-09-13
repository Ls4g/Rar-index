// Scout junk-dismissal rules, against real reviewed titles.
//
//   node --experimental-strip-types scripts/test-scout-junk-rules.mjs
//
// Every title below is a real listing a member of staff decided on. The
// dismissed ones they threw out; the kept ones they chose to watch. They are
// here so a future tightening cannot quietly start discarding buying
// opportunities -- the failure that matters, because it is silent.
//
// These rules are NOT active. scripts/eval-scout-junk-reduction.mjs measures
// them against the full benchmark, and graded_slab currently fails the recall
// gate. This file pins their behaviour so that measurement stays meaningful.
import { conservativeJunkDismissal, JUNK_RULES } from "../lib/scoutJunkRules.ts";

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

const v1Japanese = { series: "ONE PIECE", volume_number: "1", language: "Japanese", publisher: "Shueisha" };
const v1English = { series: "One Piece", volume_number: "1", language: "English", publisher: "VIZ Media" };

console.log("\n--- graded slabs staff dismissed ---");
for (const title of [
  "BGS 9.6 Black Clover Vol. 1 1st Print Obi Comics Manga Books 2015 Japanese",
  "BGS 5.5 One Piece Comic Vol.1 First Print 1st 1997 Manga from JAPAN ON004",
  "CBCS 5.5 ONE PIECE Vol.1 1st Print DJ 4.5 First PSA BGS CGC Japanese Manga",
  "Naruto Vol 1 #1 First 1st Print Shueisha Shonen Jump Manga W/ Obi BGS 8.5",
  "w/ Obi & COMICS NEWS : BLEACH Vol.1 1st print BGS 5.0 Kubo Taito Shueisha",
]) {
  check(`"${title.slice(0, 46)}…"`, conservativeJunkDismissal(v1Japanese, title)?.rule, "graded_slab");
}

console.log("\n--- multi-volume lots staff dismissed ---");
for (const title of [
  "One Piece East Blue Manga Omnibus Ed Vol 1 2 3 VIZ Media Book 1997/2023",
  "Black Clover, Vol. 1 2 3 Magna Anime Paperback –   by Yuki Tabata English",
  "Dragon Ball 3-in-1 Edition Vol. 1 Softcover English Manga by Akira Toriyama",
  "Initial D Omnibus #1-#9 Paperback by Shuichi Shigeno",
]) {
  const verdict = conservativeJunkDismissal(v1English, title);
  check(`"${title.slice(0, 46)}…"`, Boolean(verdict), true);
}

console.log("\n--- ordinary single volumes staff chose to watch ---");
for (const title of [
  "Naruto, Vol. 1 Paperback Masashi Kishimoto",
  "One Piece Manga Vol 1 (English) Eiichiro Oda VIZ MEDIA",
  "Jujutsu Kaisen Vol. 1 Manga Softcover by Gege Akutami VIZ Media English",
  "HUNTER × HUNTER Vol.1 First Edition Japanese Manga Comic Yoshihiro Togashi",
  "Naruto Volume 1 1st First Print Edition Manga English Printing",
  "Attack on Titan (AOT) Volume 1 Hajime Isayama Kodansha Manga- English Version",
]) {
  check(`kept: "${title.slice(0, 44)}…"`, conservativeJunkDismissal(v1English, title), null);
}

console.log("\n--- the known recall cost, pinned deliberately ---");
// A member of staff watched this one. It is a graded slab, so graded_slab
// fires on it, and that is precisely why the rule is not active: a graded copy
// of a tracked edition is a real buying opportunity in a different market, not
// junk. Should this ever be made safe, it will be by routing graded listings
// to their own queue rather than by loosening the detector.
check("a graded slab a human wanted is still caught by the rule",
  conservativeJunkDismissal({ series: "Demon Slayer: Kimetsu no Yaiba", volume_number: "1", language: "Japanese", publisher: "Shueisha" },
    "BGS 7.0 Demon Slayer Kimetsu no Yaiba Vol. 1 1st Print Manga 2016 Japanese")?.rule,
  "graded_slab");

console.log("\n--- a single omnibus volume is an opportunity, a run of them is not ---");
// Staff drew this line on the benchmark themselves. "Initial D Omnibus #1-#9"
// was dismissed; "Initial D Omnibus 1 (Vol. 1)" and "Attack On Titan Manga
// Omnibus Volume 1" were kept. Dismissing every title containing "omnibus"
// cost three genuine opportunities, two on the development half and one on the
// holdout.
for (const title of [
  "Initial D Omnibus 1 (Vol. 1) - Shuichi Shigeno - Book - English",
  "Attack On Titan Manga Omnibus Volume 1 Hajime Isayama Kodansha Comics",
  "Fullmetal Alchemist Omnibus Volume 2 English Manga",
]) {
  check(`kept: "${title.slice(0, 44)}…"`, conservativeJunkDismissal(v1English, title), null);
}
for (const title of [
  "Initial D Omnibus #1-#9 Paperback by Shuichi Shigeno",
  "One Piece Omnibus 3-in-1 (Vol. 10 11 12) by Eiichiro Oda English Manga",
  "East Blue One Piece Manga Omnibus Ed Vol 1 2 3 VIZ Media Book",
]) {
  check(`dismissed: "${title.slice(0, 40)}…"`, Boolean(conservativeJunkDismissal(v1English, title)), true);
}

console.log("\n--- the rules are not wired into anything that runs ---");
// Both rules are shadow-only, and graded leads are routed to their own Scout
// view rather than dismissed. That is a decision, not an accident: if a
// production module ever imports these rules, graded first prints start
// disappearing silently. This check is what makes that impossible to do by
// mistake.
const { readdir, readFile } = await import("node:fs/promises");
const roots = ["lib", "app", "components"];
const importers = [];
async function walk(dir) {
  for (const entry of await readdir(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) { await walk(path); continue; }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    if (path === "lib/scoutJunkRules.ts") continue;
    const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    if (/scoutJunkRules|conservativeJunkDismissal/.test(source)) importers.push(path);
  }
}
for (const root of roots) await walk(root);
check(`no production module imports the junk rules${importers.length ? ` (found: ${importers.join(", ")})` : ""}`, importers.length, 0);

console.log("\n--- shape guarantees ---");
check("every rule has a key", JUNK_RULES.every((rule) => Boolean(rule.key)), true);
check("a dismissal always carries a reason a person can check",
  Boolean(conservativeJunkDismissal(v1Japanese, "CGC 9.8 One Piece Vol 1")?.reason), true);
check("an empty title dismisses nothing", conservativeJunkDismissal(v1English, ""), null);
check("a missing title dismisses nothing", conservativeJunkDismissal(v1English, null), null);

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
