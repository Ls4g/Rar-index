// node --experimental-strip-types scripts/test-edition-search-query.mjs
import assert from "node:assert/strict";
import { parseEditionSearch, compareVolumes } from "../lib/editionSearchQuery.ts";

assert.deepEqual(parseEditionSearch("Naruto 5"), { isbn: null, volume: "5", words: ["naruto"] });
assert.deepEqual(parseEditionSearch("naruto vol 5"), { isbn: null, volume: "5", words: ["naruto"] });
assert.deepEqual(parseEditionSearch("One Piece volume 03"), { isbn: null, volume: "3", words: ["one", "piece"] });
assert.deepEqual(parseEditionSearch("Death Note, Vol. 12"), { isbn: null, volume: "12", words: ["death", "note"] });
assert.deepEqual(parseEditionSearch("Berserk #1"), { isbn: null, volume: "1", words: ["berserk"] });
assert.deepEqual(parseEditionSearch("Naruto"), { isbn: null, volume: null, words: ["naruto"] });
assert.deepEqual(parseEditionSearch("978-1-4215-0242-2"), { isbn: "9781421502422", volume: null, words: [] });
assert.deepEqual(parseEditionSearch("1421502429"), { isbn: "1421502429", volume: null, words: [] });
assert.deepEqual(parseEditionSearch("20th Century Boys"), { isbn: null, volume: null, words: ["20th", "century", "boys"] });
assert.deepEqual(parseEditionSearch("Hunter x Hunter 2"), { isbn: null, volume: "2", words: ["hunter", "hunter"] });
assert.deepEqual(["10", "2", "1", null, "special"].sort(compareVolumes), ["1", "2", "10", null, "special"].sort(compareVolumes));
assert.deepEqual(["10", "2", "1"].sort(compareVolumes), ["1", "2", "10"]);
console.log("edition search query: ok");
