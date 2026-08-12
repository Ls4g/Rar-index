import { describeAvailability, AVAILABILITY_CAVEAT } from "../lib/availability.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) failures += 1;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${condition ? "" : `  ${extra}`}`);
}

const NOW = new Date("2026-08-12T12:00:00Z").getTime();
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const base = { activeProfiles: 1, completedScans: 9, lastScanAt: ago(0), leadsEverSeen: 0, lastLeadSeenAt: null, liveNow: 0 };

// --- the six states --------------------------------------------------------
const notMonitored = describeAvailability({ ...base, activeProfiles: 0, completedScans: 0 }, NOW);
check("no profile -> not_monitored", notMonitored.status === "not_monitored", notMonitored.status);
check("no profile claims nothing", notMonitored.isSignal === false);

const awaiting = describeAvailability({ ...base, completedScans: 0 }, NOW);
check("profile but no scan -> awaiting_first_scan", awaiting.status === "awaiting_first_scan", awaiting.status);
check("awaiting claims nothing", awaiting.isSignal === false);

const live = describeAvailability({ ...base, leadsEverSeen: 5, lastLeadSeenAt: ago(0), liveNow: 3 }, NOW);
check("live listings -> on_sale_now", live.status === "on_sale_now", live.status);
check("live label counts them", live.label === "3 on sale now", live.label);

const recent = describeAvailability({ ...base, leadsEverSeen: 5, lastLeadSeenAt: ago(10) }, NOW);
check("lead 10 days ago -> seen_recently", recent.status === "seen_recently", recent.status);

const stale = describeAvailability({ ...base, leadsEverSeen: 5, lastLeadSeenAt: ago(200) }, NOW);
check("lead 200 days ago -> not_seen_recently", stale.status === "not_seen_recently", stale.status);
check("stale is a signal after 9 scans", stale.isSignal === true);

const never = describeAvailability({ ...base, leadsEverSeen: 0 }, NOW);
check("scanned often, never a lead -> never_seen", never.status === "never_seen", never.status);
check("never_seen is a signal after 9 scans", never.isSignal === true);

// --- the honesty guards ----------------------------------------------------
const barelyChecked = describeAvailability({ ...base, completedScans: 1, leadsEverSeen: 0 }, NOW);
check("one scan is not enough to be a signal", barelyChecked.isSignal === false);
check("one scan says so out loud", /too few checks/i.test(barelyChecked.detail), barelyChecked.detail);

const all = [notMonitored, awaiting, live, recent, stale, never, barelyChecked];
check("no state ever says 'out of print'", all.every(a => !/out of print/i.test(`${a.label} ${a.detail}`)));
check("no state claims the publisher stopped printing", all.every(a => !/(discontinued|no longer printed|ceased)/i.test(`${a.label} ${a.detail}`)));
check("every state has a label and a detail", all.every(a => a.label && a.detail));
check("caveat names the single marketplace", /ebay/i.test(AVAILABILITY_CAVEAT));
check("caveat disclaims the out-of-print inference", /not proof/i.test(AVAILABILITY_CAVEAT));

// --- boundaries ------------------------------------------------------------
check("45 days is still recent", describeAvailability({ ...base, leadsEverSeen: 1, lastLeadSeenAt: ago(45) }, NOW).status === "seen_recently");
check("46 days is not", describeAvailability({ ...base, leadsEverSeen: 1, lastLeadSeenAt: ago(46) }, NOW).status === "not_seen_recently");
check("live wins over a stale last-seen", describeAvailability({ ...base, leadsEverSeen: 9, lastLeadSeenAt: ago(400), liveNow: 1 }, NOW).status === "on_sale_now");
check("unparseable date does not crash", describeAvailability({ ...base, leadsEverSeen: 1, lastLeadSeenAt: "not-a-date" }, NOW).status.length > 0);

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
