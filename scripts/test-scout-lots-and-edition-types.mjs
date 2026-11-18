// Lots and other-edition listings on a single-volume record.
//   node --experimental-strip-types scripts/test-scout-lots-and-edition-types.mjs
//
// Owner's rule (16 Nov 2026): on a single-volume record, lots are dismissed
// and omnibus / deluxe / perfect / anniversary copies are conflicts shown to
// a person. Titles are real listings staff dismissed. Replayed on all 1,477
// staff Scout decisions before shipping.
import assert from "node:assert/strict";
import { assessScoutListing } from "../lib/scoutIngest.ts";
import { decideScoutAutoDismiss } from "../lib/scoutAutoTriage.ts";

const ed = (series, v, language, publisher, extra = {}) => ({ id: "x", title: `${series}, Vol. ${v}`, series, volume_number: String(v), language, isbn_13: null, publisher, format: null, printing_number: null, edition_statement: null, variant_name: null, collectible_type: "tankobon", ...extra });
const conflicts = (e, t) => assessScoutListing(e, t).conflicts;
const LOT = /multi-volume lot or set/;

for (const [t, e] of [
  ["Bleach Manga Shonen Jump English Vol. 5 6 22 23 24 & 29 Former Library Books", ed("Bleach", 5, "English", "VIZ Media")],
  ["Dragon Ball Vol 10 11 12 Manga Shonen Jump English Akira Toriyama Paperback", ed("Dragon Ball", 10, "English", "VIZ Media")],
  ["ALL 1st Print Edition Black Clover Vol.1.3.4.5 #1 Manga Comic Japanese OBI Rare", ed("Black Clover", 1, "Japanese", "Shueisha")],
  ["# 1 2 3 Demon Slayer Kimetsu No Yaiba  Viz 2018 papaperback", ed("Demon Slayer: Kimetsu no Yaiba", 1, "English", "VIZ Media")],
  ["BLEACH Vol.1 ＋2 1st Edition Very Rere First Printing Japanese Manga Comic  Kubo", ed("Bleach", 1, "Japanese", "Shueisha")],
  ["Attack on Titan + Demon Slayer + BLEACH Vol. 1 Japanese 3 Books", ed("Bleach", 1, "Japanese", "Shueisha")],
]) assert.ok(conflicts(e, t).some((c) => LOT.test(c)), `lot not caught: ${t}`);

// One volume, however it is written, is not a lot.
for (const [t, e] of [
  ["Black Clover Vol 1 #1 First Print Japanese Manga W/ Obi", ed("Black Clover", 1, "Japanese", "Shueisha")],
  ["One Piece Vol. 1 2nd Print 1997 Japanese", ed("One Piece", 1, "Japanese", "Shueisha")],
  ["Chainsaw Man Vol. 1 2019 1st Print Japanese", ed("Chainsaw Man", 1, "Japanese", "Shueisha")],
  ["Naruto Vol 1 100% authentic VIZ English", ed("Naruto", 1, "English", "VIZ Media")],
  ["Jujutsu Kaisen Vol. 1 English VIZ 1 owner", ed("Jujutsu Kaisen", 1, "English", "VIZ Media")],
]) assert.ok(!conflicts(e, t).some((c) => LOT.test(c)), `single volume read as a lot: ${t}`);

// Other editions: a conflict a person sees, never auto-dismissed.
for (const [t, e, kind] of [
  ["Dragon Ball 3-in-1 Edition Vol. 1 Softcover English Manga by Akira Toriyama", ed("Dragon Ball", 1, "English", "VIZ Media"), /omnibus/],
  ["Dragon Ball (VIZBIG Edition) Vol. 3 By Akira Toriyama (Paperback)~First Printing", ed("Dragon Ball", 3, "English", "VIZ Media"), /omnibus/],
  ["Berserk Delux Edition Vol.9 by Kentaro Miura English Manga", ed("Berserk", 9, "English", "Dark Horse Comics"), /deluxe/],
  ["Fist of the North Star 完全版 Vol. 1 w/obi 1st Printing Japanese Manga", ed("Fist of the North Star", 1, "Japanese", "Shueisha"), /kanzenban/],
  ["Bleach 20th Anniversary Edition Vol 1 Softcover English Manga by Tite Kubo", ed("Bleach", 1, "English", "VIZ Media"), /anniversary/],
]) {
  const found = conflicts(e, t);
  assert.ok(found.some((c) => kind.test(c)), `edition type not caught: ${t}`);
  assert.equal(decideScoutAutoDismiss(e, t).shouldDismiss, false, `must not auto-dismiss: ${t}`);
}

// A record that IS the omnibus / deluxe edition keeps its leads.
assert.deepEqual(conflicts(ed("One Piece", 1, "English", "VIZ Media", { title: "One Piece (Omnibus Edition), Vol. 1" }), "One Piece Omnibus Edition Vol 1 VIZ English"), []);
assert.deepEqual(conflicts(ed("Berserk", 9, "English", "Dark Horse Comics", { edition_statement: "Deluxe Edition" }), "Berserk Deluxe Edition Volume 9 English Dark Horse"), []);
// An omnibus record: a listing spelling out the volumes it collects is that book, not a lot.
assert.deepEqual(conflicts(ed("One Piece", 1, "English", "VIZ Media", { title: "One Piece (Omnibus Edition), Vol. 1" }), "One Piece Omnibus Vol 1 includes vols 1, 2 & 3 VIZ English"), []);
console.log("lot and edition-type checks passed");
