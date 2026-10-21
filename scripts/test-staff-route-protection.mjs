// Every staff page must be behind the staff gate.
//
//   node scripts/test-staff-route-protection.mjs
//
// No network, no database: this reads the routes off disk and compares them to
// proxy.ts's matcher.
//
// The matcher is a hand-maintained list, which is a design that fails quietly.
// /price-coverage shipped on 21 October 2026 and was served to anyone who
// asked -- HTTP 200, no redirect -- while every other staff page redirected to
// the sign-in. Nothing broke, no error was logged, and the page looked
// completely normal to the person who built it, because they were signed in.
//
// So the rule is enforced here instead of remembered: a page that renders
// StaffNav is a staff page, and a staff page absent from the matcher fails the
// suite.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const APP = "app";
const PROXY = "proxy.ts";

function pagesUnder(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pagesUnder(full, found);
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

const proxySource = fs.readFileSync(PROXY, "utf8");
const matcherBlock = /matcher:\s*\[([\s\S]*?)\]/.exec(proxySource);
assert.ok(matcherBlock, "proxy.ts must export a config.matcher array");
const matcher = [...matcherBlock[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
assert.ok(matcher.length > 10, `expected a populated matcher, found ${matcher.length} entries`);

/** The URL path a page file serves, with route groups and dynamic parts kept. */
function routeFor(file) {
  const route = file
    .replaceAll("\\", "/")
    .replace(/^app/, "")
    .replace(/\/page\.tsx$/, "")
    .replace(/\/\([^/]+\)/g, "");
  return route === "" ? "/" : route;
}

function isCovered(route) {
  return matcher.some((pattern) => {
    const base = pattern.replace(/\/:path\*$/, "");
    return route === base || route.startsWith(`${base}/`);
  });
}

const staffPages = pagesUnder(APP)
  .filter((file) => {
    // A page that mounts the staff navigation is, by definition, a staff page.
    // Design-concept prototypes are excluded: they render no real data.
    if (file.replaceAll("\\", "/").includes("app/design-concept/")) return false;
    return fs.readFileSync(file, "utf8").includes("StaffNav");
  })
  .map(routeFor);

assert.ok(staffPages.length > 5, `expected to find the staff pages, found ${staffPages.length}`);

const unprotected = staffPages.filter((route) => !isCovered(route));
assert.deepEqual(
  unprotected,
  [],
  `these staff pages are served to anyone, because proxy.ts's matcher does not cover them:\n  ${unprotected.join("\n  ")}\n` +
  `Add "<route>/:path*" to the matcher in proxy.ts.`,
);

// The staff API routes matter just as much, and most carry their own
// isStaffRequest check as well. A route with neither is reachable by anyone.
const apiRoutes = [];
function apisUnder(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) apisUnder(full);
    else if (entry.name === "route.ts") apiRoutes.push(full);
  }
}
apisUnder(path.join(APP, "api"));

// These are deliberately reachable without a staff session, each for a stated
// reason. Anything NOT listed here must gate itself or sit behind the matcher.
const INTENTIONALLY_PUBLIC = new Set([
  "/api/staff-session",        // the sign-in itself
  "/api/community-report",     // visitors report a sale
  "/api/edition-request",      // visitors ask for an edition
  "/api/ebay/account-deletion",// eBay's compliance webhook
  "/api/portfolio-activity",   // public Scout data for a signed-in collector's shelf
  "/api/portfolio-snapshot",   // verifies a Supabase Auth bearer token itself
]);

const ungatedApis = apiRoutes
  // Normalise separators first: on Windows these arrive with backslashes, and
  // a path regex expecting "/" silently matches nothing.
  .map((file) => ({ file, route: routeFor(file.replaceAll("\\", "/").replace(/\/route\.ts$/, "/page.tsx")) }))
  .filter(({ file, route }) => {
    if (INTENTIONALLY_PUBLIC.has(route)) return false;
    if (route.startsWith("/api/cron/")) return false; // gated by CRON_SECRET
    const source = fs.readFileSync(file, "utf8");
    const gatesItself = /isStaffRequest|auth\.getUser/.test(source);
    return !gatesItself && !isCovered(route);
  })
  .map(({ route }) => route);

assert.deepEqual(
  ungatedApis,
  [],
  `these API routes have no staff check and are not in the proxy matcher:\n  ${ungatedApis.join("\n  ")}`,
);

console.log(`Staff route protection: ${staffPages.length} staff pages and ${apiRoutes.length} API routes checked, all gated.`);
