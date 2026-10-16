import assert from "node:assert/strict";
import { adjacentPublication } from "../lib/publicationNavigation.ts";

const current = { id: "viz-1", number: 1, language: "English", publisher: "VIZ Media", format: "Paperback", release_date: "2003-09-02" };
const editions = [
  { id: "orion-2", number: 2, language: "English", publisher: "Orion", format: "Paperback", release_date: "2005-01-01" },
  { id: "viz-2-hardcover", number: 2, language: "English", publisher: "VIZ Media LLC", format: "Hardcover", release_date: "2004-01-01" },
  { id: "viz-2", number: 2, language: "English", publisher: "VIZ Media LLC", format: "Paperback", release_date: "2004-09-02" },
  { id: "viz-3", number: 3, language: "English", publisher: "VIZ Media", format: "Paperback", release_date: "2005-09-02" },
  { id: "viz-japanese-2", number: 2, language: "Japanese", publisher: "VIZ Media", format: "Paperback", release_date: "2004-09-02" },
];
assert.equal(adjacentPublication(current, editions, "next")?.id, "viz-2", "same publisher and format wins even if another publisher appears first");
assert.equal(adjacentPublication(current, [editions[0]], "next"), null, "another publisher is not a sequential volume");
assert.equal(adjacentPublication(editions[3], [current], "previous")?.id, "viz-1");
assert.equal(adjacentPublication({ ...current, publisher: null }, editions, "next"), null, "unknown publisher cannot imply a physical run");
console.log("publication navigation checks passed");
