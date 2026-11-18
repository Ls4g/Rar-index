// Publisher spelling must not read as a publisher conflict.
//
//   node --experimental-strip-types scripts/test-scout-publisher-family.mjs
//
// The watched leads below were auto-dismissed in November 2026 because the
// listing's publisher came out as "Kodansha" and the edition is recorded as
// "Kodansha Comics". A real publisher difference must still conflict.
import assert from "node:assert/strict";
import { assessScoutListing } from "../lib/scoutIngest.ts";

const edition = (series, publisher, language = "English", volume = "1") => ({
  id: `${series}-${publisher}`, title: `${series}, Vol. ${volume}`, series, volume_number: volume, language,
  isbn_13: null, publisher, format: null, printing_number: null, edition_statement: null, variant_name: null,
  collectible_type: "tankobon", issue_year: null, issue_number_label: null, cumulative_issue_no: null,
});
const AOT = edition("Attack on Titan", "Kodansha Comics");
const AKIRA = edition("Akira", "Kodansha Comics");
const conflictsFor = (target, title) => assessScoutListing(target, title).conflicts;

for (const [target, title] of [
  [AOT, "Attack on Titan Volume 1 Manga - Kodansha USA Series (English Edition)"],
  [AOT, "Attack On Titan Manga Volume 1 Kodansha English Edition"],
  [AOT, "Attack on Titan Vol 1 English Manga By Hajime Isayama Kodansha Comics NEW"],
  [AKIRA, "Akira Vol 1 Katsuhiro Otomo Kodansha Manga Graphic Novel Paperback English"],
]) {
  assert.ok(!conflictsFor(target, title).some((c) => /publisher/.test(c)), `false publisher conflict: ${title}`);
}

// Genuine differences still conflict.
assert.ok(conflictsFor(AOT, "Attack on Titan Vol 1 English VIZ Media").some((c) => /publisher/.test(c)), "VIZ vs Kodansha must conflict");
assert.ok(conflictsFor(edition("Naruto", "VIZ Media"), "Naruto Vol 1 English Kodansha").some((c) => /publisher/.test(c)), "Kodansha vs VIZ must conflict");
assert.ok(!conflictsFor(edition("Naruto", "VIZ Media"), "Naruto Vol 1 VIZ Media English").some((c) => /publisher/.test(c)), "same publisher must not conflict");
console.log("publisher family checks passed");

// Boruto is Naruto's sequel series, not Naruto (staff dismissed a Boruto
// Vol. 1 on the Naruto Vol. 1 profile; no Boruto listing was ever watched).
{
  const NARUTO_JP = edition("Naruto", "Shueisha", "Japanese");
  assert.ok(conflictsFor(NARUTO_JP, "BORUTO Naruto Next Generations Vol.1 First Edition 2016 Japanese Manga").some((c) => /different series/.test(c)));
  assert.ok(!conflictsFor(NARUTO_JP, "Naruto Vol.1 First Edition 2000 Japanese Manga Shueisha").some((c) => /different series/.test(c)));
  console.log("Boruto sister-series check passed");
}
