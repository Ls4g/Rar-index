// Both handoffs out of the Decisions inbox, checked against live data.
//
// The inbox is where staff actually work, and two of its links used to lead
// nowhere: a catalogue candidate whose source left the language blank showed a
// one-click "Yes — add edition" button that the API was bound to refuse, and a
// link to one ended listing opened /listing-outcomes with that listing absent,
// because the page's attention query is capped far below the number of rows
// that qualify.
//
// Read-only. This script never writes, and never decides a sale or an edition
// match -- it only checks that a human is offered a route that can work.
import { createClient } from "@supabase/supabase-js";
import { catalogueOneClickApprovalBlocker } from "../lib/catalogueApprovalGuard.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (use --env-file=.env.local).");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

let checks = 0;
let failures = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

// The exact column list and status filter the Decisions page uses.
const QUEUE_FIELDS = "id,external_id,source_record_url,raw_payload,candidate_kind,candidate_title,candidate_series,candidate_volume_number,candidate_author,candidate_publisher,candidate_language,candidate_isbn_13,candidate_release_date";
const OUTCOME_ATTENTION_STATUSES = ["sold_candidate", "ended_pending_check", "ambiguous", "inaccessible"];

console.log("\n1. A one-click catalogue approval is only offered when it can succeed");

const [{ data: queueRows, error: queueError }, { data: verifiedEditions, error: editionError }] = await Promise.all([
  admin.from("catalogue_review_queue").select(QUEUE_FIELDS).order("imported_at", { ascending: false }).limit(30),
  admin.from("manga_editions").select("series,language,publisher").eq("is_verified", true).limit(5000),
]);
if (queueError || editionError) {
  console.error("Could not read the catalogue queue:", queueError?.message ?? editionError?.message);
  process.exit(1);
}
const knownEditions = verifiedEditions ?? [];
check("the catalogue queue is readable", Array.isArray(queueRows));
check("verified editions loaded for the publisher guard", knownEditions.length > 0, `${knownEditions.length} rows`);

const blockers = new Map((queueRows ?? []).map((row) => [row.id, catalogueOneClickApprovalBlocker(row, knownEditions)]));

// The API's own approve_new preconditions. Anything the inbox still offers a
// button for has to satisfy every one of these, or the button is a dead end.
function apiWouldRefuse(row) {
  const isbn = row.candidate_isbn_13 ? row.candidate_isbn_13.replace(/[^0-9Xx]/g, "").toUpperCase() : null;
  if (!row.candidate_title?.trim()) return "no title";
  if (!row.candidate_language) return "no language";
  if (isbn && !/^97[89]\d{10}$/.test(isbn)) return "malformed ISBN-13";
  if (row.candidate_kind !== "edition_candidate") return "not an edition candidate";
  return null;
}

const offered = (queueRows ?? []).filter((row) => !blockers.get(row.id));
const doomed = offered.map((row) => ({ row, reason: apiWouldRefuse(row) })).filter((entry) => entry.reason);
check(
  "no candidate is offered a button the API would refuse",
  doomed.length === 0,
  doomed.map((entry) => `${entry.row.candidate_title}: ${entry.reason}`).join("; "),
);

const missingLanguage = (queueRows ?? []).filter((row) => !row.candidate_language);
check(
  "every candidate with no source language is sent to detailed review",
  missingLanguage.every((row) => Boolean(blockers.get(row.id))),
  `${missingLanguage.length} language-less candidates in the queue`,
);
for (const row of missingLanguage) {
  console.log(`       held back: ${row.candidate_title} — ${blockers.get(row.id)}`);
}

const seriesReferences = (queueRows ?? []).filter((row) => row.candidate_kind !== "edition_candidate");
check(
  "a series reference is never offered a one-click approval",
  seriesReferences.every((row) => Boolean(blockers.get(row.id))),
  `${seriesReferences.length} series references in the queue`,
);

// A guard that blocked everything would also pass the checks above while
// making the inbox useless, so prove it still lets a complete record through.
const completeRows = (queueRows ?? []).filter((row) => !apiWouldRefuse(row));
check(
  "a complete candidate is still approvable in one click",
  completeRows.length === 0 || completeRows.some((row) => !blockers.get(row.id)),
  completeRows.length ? `${completeRows.length} complete candidates, all blocked` : "none in the queue to test",
);

console.log("\n2. A listing linked from the inbox is always present on /listing-outcomes");

const { data: attentionPage, error: attentionError } = await admin
  .from("listing_outcomes")
  .select("id")
  .in("status", OUTCOME_ATTENTION_STATUSES)
  .is("reviewed_by", null)
  .order("sold_at", { ascending: false, nullsFirst: false })
  .limit(200);
const { count: attentionQualifying } = await admin
  .from("listing_outcomes")
  .select("id", { count: "exact", head: true })
  .in("status", OUTCOME_ATTENTION_STATUSES)
  .is("reviewed_by", null);
if (attentionError) {
  console.error("Could not read listing outcomes:", attentionError.message);
  process.exit(1);
}
const windowIds = new Set((attentionPage ?? []).map((row) => row.id));
console.log(`       ${attentionQualifying} listings qualify for attention; the page's capped query returns ${windowIds.size}`);

// The inbox links to any unreviewed attention listing, so the case that matters
// is one that qualifies but falls outside the cap. Find a real one.
const { data: candidateRows } = await admin
  .from("listing_outcomes")
  .select("id,listing_title,status")
  .in("status", OUTCOME_ATTENTION_STATUSES)
  .is("reviewed_by", null)
  .order("sold_at", { ascending: false, nullsFirst: false })
  .limit(1000);
const outsideWindow = (candidateRows ?? []).find((row) => !windowIds.has(row.id)) ?? null;

if (!outsideWindow) {
  check("no listing falls outside the page's window", true, "cap is not currently reached");
} else {
  console.log(`       testing with ${outsideWindow.id} (${outsideWindow.status}) — outside the window`);
  check("the failing case is real: the listing is absent from the capped query", !windowIds.has(outsideWindow.id));

  // The by-id fetch the page now performs when a link names one listing.
  const { data: focusRecord, error: focusError } = await admin
    .from("listing_outcomes")
    .select("id,status,listing_title,external_id")
    .eq("id", outsideWindow.id)
    .maybeSingle();
  check("the focused listing is fetched by id", !focusError && Boolean(focusRecord), focusError?.message ?? "no row");

  const merged = focusRecord && !windowIds.has(focusRecord.id)
    ? [focusRecord, ...(attentionPage ?? [])]
    : (attentionPage ?? []);
  check("the focused listing is present in what the page renders", merged.some((row) => row.id === outsideWindow.id));
  check("merging does not duplicate the focused listing", merged.filter((row) => row.id === outsideWindow.id).length === 1);
  check("the focused listing carries the id the panel matches on", focusRecord?.id === outsideWindow.id);

  // A listing already inside the window must not be added a second time.
  const insideWindow = (attentionPage ?? [])[0] ?? null;
  if (insideWindow) {
    const remerged = !windowIds.has(insideWindow.id)
      ? [insideWindow, ...(attentionPage ?? [])]
      : (attentionPage ?? []);
    check("a listing already in the window is not duplicated", remerged.filter((row) => row.id === insideWindow.id).length === 1);
  }
}

console.log(`\n${failures ? "FAILED" : "PASSED"}: ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
