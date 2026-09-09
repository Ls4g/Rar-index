import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const outcomeCron = await readFile(new URL("../app/api/cron/listing-outcomes/route.ts", import.meta.url), "utf8");
const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

assert.doesNotMatch(outcomeCron, /searchParams\.get\(["']secret["']\)/, "Cron credentials must never be accepted in a URL");
assert.match(outcomeCron, /headers\.get\(["']authorization["']\)/, "Listing outcomes cron requires the Authorization header");

const paths = new Set(vercel.crons.map((cron) => cron.path));
for (const path of ["/api/cron/ebay-scout", "/api/cron/listing-outcomes", "/api/cron/rar-agents", "/api/cron/agent-reliability", "/api/cron/portfolio-snapshots"]) {
  assert(paths.has(path), `${path} must remain scheduled`);
}

console.log("Operations guard checks passed.");
