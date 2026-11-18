// Series batches: one-click selection, and no automatic Scout search.
//   node --experimental-strip-types scripts/test-series-batch.mjs
import assert from "node:assert/strict";
import { skipBatchEdition } from "../lib/scoutProfileSeed.ts";

const batch = new Set(["dn6", "dn1b"]);
assert.equal(skipBatchEdition({ id: "dn6", volume_number: "6" }, batch), true, "batch volume 6: no automatic search");
assert.equal(skipBatchEdition({ id: "dn1b", volume_number: "1" }, batch), false, "batch volume 1 still gets one");
assert.equal(skipBatchEdition({ id: "single", volume_number: "6" }, batch), false, "one-at-a-time imports unchanged");
console.log("series batch seed checks passed");
