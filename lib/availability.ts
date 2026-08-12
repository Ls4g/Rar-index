// "Can I still buy this?" — the question a collector asks the moment a
// series goes out of print, and the point at which someone who only wanted a
// shelf starts needing evidence.
//
// RAR deliberately does NOT claim a book is out of print. That is a fact
// about a publisher's intentions, and RAR has no publisher feed; inferring it
// from silence would be exactly the kind of invented claim the evidence rules
// forbid. What RAR can state is what it observed: how many times it looked,
// and when it last saw a copy for sale. Those are facts, they answer the same
// practical question, and they cannot be wrong.
//
// Every status below is therefore about RAR's own observations, and the
// wording never generalises beyond the one marketplace RAR watches.

export type AvailabilityInput = {
  /** Active marketplace search profiles covering this publication family. */
  activeProfiles: number;
  /** Completed (not failed) Scout scans across those profiles. */
  completedScans: number;
  /** Most recent completed scan, ISO string. */
  lastScanAt: string | null;
  /** Every listing lead ever captured for the family, ended or not. */
  leadsEverSeen: number;
  /** Most recently observed listing, ISO string. */
  lastLeadSeenAt: string | null;
  /** Listings currently live: seen recently and not past their end time. */
  liveNow: number;
};

export type AvailabilityStatus =
  | "not_monitored"
  | "awaiting_first_scan"
  | "on_sale_now"
  | "seen_recently"
  | "not_seen_recently"
  | "never_seen";

export type Availability = {
  status: AvailabilityStatus;
  /** Short label. Never says "out of print" — RAR cannot know that. */
  label: string;
  /** One sentence of exactly what RAR observed. */
  detail: string;
  /** True only where RAR has looked enough times to make silence meaningful. */
  isSignal: boolean;
  daysSinceLastLead: number | null;
};

const DAY = 24 * 60 * 60 * 1000;
// Below this many completed scans, silence says more about RAR than about the
// market, so it is reported without being treated as a signal.
const MIN_SCANS_FOR_SIGNAL = 3;
const RECENT_DAYS = 45;

function daysSince(value: string | null, now: number) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((now - time) / DAY)) : null;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "an unrecorded date"
    : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function describeAvailability(input: AvailabilityInput, now: number = Date.now()): Availability {
  const daysSinceLastLead = daysSince(input.lastLeadSeenAt, now);

  if (input.activeProfiles === 0) {
    return {
      status: "not_monitored",
      label: "Not being watched",
      detail: "RAR is not yet watching any marketplace for copies of this, so it cannot say whether one is available.",
      isSignal: false,
      daysSinceLastLead,
    };
  }

  if (input.completedScans === 0) {
    return {
      status: "awaiting_first_scan",
      label: "Watch just started",
      detail: "RAR has begun watching for copies but has not completed a scan yet.",
      isSignal: false,
      daysSinceLastLead,
    };
  }

  if (input.liveNow > 0) {
    return {
      status: "on_sale_now",
      label: `${input.liveNow} on sale now`,
      detail: `RAR can see ${input.liveNow} active listing${input.liveNow === 1 ? "" : "s"} matching this exact edition.`,
      isSignal: true,
      daysSinceLastLead,
    };
  }

  if (input.leadsEverSeen === 0) {
    const enough = input.completedScans >= MIN_SCANS_FOR_SIGNAL;
    return {
      status: "never_seen",
      label: enough ? "Never seen for sale" : "None found yet",
      detail: enough
        ? `RAR has checked ${input.completedScans} times and has never found a copy of this exact edition for sale.`
        : `RAR has checked ${input.completedScans} time${input.completedScans === 1 ? "" : "s"} so far and not found a copy. That is too few checks to mean much yet.`,
      isSignal: enough,
      daysSinceLastLead,
    };
  }

  const seenOn = input.lastLeadSeenAt ? formatDate(input.lastLeadSeenAt) : "an unrecorded date";
  if (daysSinceLastLead !== null && daysSinceLastLead <= RECENT_DAYS) {
    return {
      status: "seen_recently",
      label: "Recently on sale",
      detail: `The last copy RAR saw listed was on ${seenOn}. None are live right now.`,
      isSignal: true,
      daysSinceLastLead,
    };
  }

  return {
    status: "not_seen_recently",
    label: "Not seen for a while",
    detail: `RAR last saw a copy listed on ${seenOn}, and has checked ${input.completedScans} times since it started watching.`,
    isSignal: input.completedScans >= MIN_SCANS_FOR_SIGNAL,
    daysSinceLastLead,
  };
}

/** The caveat that must accompany any availability claim RAR makes. */
export const AVAILABILITY_CAVEAT =
  "RAR watches eBay only, and only for listings whose title clearly matches this exact edition. Not finding a copy is not proof that a book is out of print.";
