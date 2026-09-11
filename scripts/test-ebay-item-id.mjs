// eBay item id normalisation. Run with:
//   node --experimental-strip-types scripts/test-ebay-item-id.mjs
//
// This guards the bug that made the whole Watch-to-Sale pipeline useless.
//
// eBay has two ids for one listing. Browse search returns the RESTful form,
// "v1|175537033747|0". get_item_by_legacy_id and the Trading API both want
// the bare numeric legacy id in the middle of it. RAR stored the RESTful form
// and sent it straight to the legacy endpoint, so every outcome check 404ed --
// 397 of 397 -- and every watched listing was recorded as "no longer
// retrievable". Listings that were still live were reported as ended, and a
// human was asked to rule on them.
//
// The 100% failure rate was the tell: a real mix of live and ended listings
// cannot produce an identical not-found result every single time.
import { legacyItemId } from "../lib/listingOutcomeProviders.ts";

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        expected ${expected}\n        actual   ${actual}`}`);
}

console.log("\n--- the id Scout actually stores ---");
check("RESTful id yields the legacy number", legacyItemId("v1|175537033747|0"), "175537033747");
check("a real Berserk row", legacyItemId("v1|407124286283|0"), "407124286283");
check("a variation id is not appended", legacyItemId("v1|318766873787|12345"), "318766873787");

console.log("\n--- the old code's mistake ---");
// "v1|175537033747|0".replace(/[^0-9]/g, "") === "11755370337470": the 1 from
// v1 and the trailing variation 0 get welded on, producing a wrong id that
// still looks like an item number. A clean 404 would have been kinder.
check("digits-only stripping is NOT what we do now", legacyItemId("v1|175537033747|0") === "11755370337470", false);

console.log("\n--- ids that were already fine ---");
check("bare numeric passes through", legacyItemId("175537033747"), "175537033747");
check("surrounding whitespace is trimmed", legacyItemId("  175537033747 "), "175537033747");

console.log("\n--- nothing plausible is invented ---");
check("empty stays empty", legacyItemId(""), "");
check("a short number is not mistaken for an item id", legacyItemId("v1|123|0"), "123");
check("junk is returned unchanged rather than guessed at", legacyItemId("not-an-id"), "not-an-id");

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
