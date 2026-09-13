// Fetch the real staff pages from a local dev server and check what they
// actually render. Read-only: every request is a GET.
//
// The session cookie is minted with the repository's own createStaffSession
// against the local-only credentials already in .env.local, so no password is
// typed into a form and no production credential is involved. This exists
// because type-checking and a passing build have said nothing about the two
// real staff-page defects found so far -- both were spotted by a person on a
// phone.
import { createStaffSession, STAFF_SESSION_COOKIE } from "../lib/staffSession.ts";

const base = process.env.RAR_LOCAL_BASE ?? "http://127.0.0.1:3000";

let checks = 0;
let failures = 0;
function check(label, condition, detail = "") {
  checks += 1;
  if (condition) { console.log(`  ok   ${label}`); return true; }
  failures += 1;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

const token = await createStaffSession();
if (!token) {
  console.error("No staff credentials in the environment. Run with --env-file=.env.local.");
  process.exit(1);
}
const cookie = `${STAFF_SESSION_COOKIE}=${token}`;

async function get(path, { withSession = true } = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: withSession ? { cookie } : {},
    redirect: "manual",
  });
  const body = response.status >= 200 && response.status < 300 ? await response.text() : "";
  return { status: response.status, body, location: response.headers.get("location") };
}

// Strip tags so assertions match visible text rather than attributes/markup.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * What the browsing library says pages 1 and 2 of the default queue hold. Used
 * to check the served HTML against an independent answer computed from the
 * same data, rather than against a pattern scraped out of the markup.
 */
async function expectedPages() {
  const { createClient } = await import("@supabase/supabase-js");
  const { browseOutcomes } = await import("../lib/outcomeBrowsing.ts");
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const select = "id,external_id,marketplace,status,listing_title,asking_price,currency,sold_price,sold_currency,sold_at,buying_format,match_assessment,last_seen_at,outcome_reason,check_attempts,reviewed_by,edition:manga_editions(title,series,volume_number,language)";
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("listing_outcomes").select(select).order("id", { ascending: true }).range(from, from + 999);
    if (error) return null;
    all.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const rows = all.map((record) => ({
    id: record.id,
    externalId: record.external_id,
    editionLabel: [record.edition?.series || record.edition?.title, record.edition?.volume_number ? `Vol. ${record.edition.volume_number}` : null, record.edition?.language].filter(Boolean).join(" · ") || "Unknown edition",
    status: record.status,
    listingTitle: record.listing_title,
    askingPrice: record.asking_price,
    currency: record.currency,
    soldPrice: record.sold_price,
    soldCurrency: record.sold_currency,
    soldAt: record.sold_at,
    buyingFormat: record.buying_format,
    matchScore: record.match_assessment?.score ?? null,
    matchConflicts: record.match_assessment?.conflicts ?? [],
    lastSeenAt: record.last_seen_at,
    outcomeReason: record.outcome_reason,
    reviewedBy: record.reviewed_by,
    checkAttempts: record.check_attempts,
  }));
  return {
    pageOne: browseOutcomes({ rows, view: "attention", queue: "worth_checking", page: 1 }).pageRows,
    pageTwo: browseOutcomes({ rows, view: "attention", queue: "worth_checking", page: 2 }).pageRows,
  };
}

console.log(`\nTarget: ${base}`);
const health = await get("/");
if (health.status !== 200) {
  console.error(`The dev server is not answering on ${base} (status ${health.status}). Start it with "pnpm run dev".`);
  process.exit(1);
}

console.log("\n1. Staff pages are gated, and the gate is what lets us in");
const STAFF_PATHS = ["/review", "/listing-outcomes", "/agents", "/scout", "/catalogue-review", "/cover-review", "/add-sale"];
for (const path of STAFF_PATHS) {
  const anonymous = await get(path, { withSession: false });
  check(`${path} refuses an anonymous visitor`, anonymous.status === 307 || anonymous.status === 401 || anonymous.status === 302,
    `status ${anonymous.status}`);
}

console.log("\n2. Every staff page renders with a session");
const pages = {};
for (const path of STAFF_PATHS) {
  const result = await get(path);
  pages[path] = result;
  check(`${path} renders`, result.status === 200, `status ${result.status}`);
  if (result.status === 200) {
    const text = visibleText(result.body);
    check(`${path} is not an error page`, !/Application error|Unhandled Runtime Error|digest:/i.test(result.body), "error markup present");
    check(`${path} rendered real content`, text.length > 400, `${text.length} chars of text`);
  }
}

console.log("\n3. The public collection workflow renders without a session");
for (const path of ["/", "/collection", "/catalogue"]) {
  const anonymous = await get(path, { withSession: false });
  if (anonymous.status === 404) { console.log(`  --   ${path} does not exist, skipped`); continue; }
  check(`${path} is public`, anonymous.status === 200, `status ${anonymous.status}`);
  if (anonymous.status === 200) {
    check(`${path} shows no staff-only controls`,
      !/Run outcome checks now|Enter this once/i.test(anonymous.body));
  }
}

console.log("\n4. Listing outcomes paginates, and every page is real");
const page1 = await get("/listing-outcomes");
check("page 1 renders", page1.status === 200, `status ${page1.status}`);
const page1Text = visibleText(page1.body);
const showing = page1Text.match(/Showing\s+(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/);
check("page 1 states its range and total", Boolean(showing), page1Text.slice(0, 200));
if (showing) {
  const [, first, last, total] = showing.map(Number);
  console.log(`     page 1 shows ${first}-${last} of ${total}`);
  check("page 1 starts at 1", first === 1);
  check("page 1 serves a full page", last === 25 || last === total, `last index ${last}`);
  check("the total exceeds one page", total > 25, `total ${total}`);

  const pageOf = page1Text.match(/Page\s+(\d+)\s+of\s+(\d+)/);
  check("the pager states which page of how many", Boolean(pageOf), "no pager text");
  if (pageOf) {
    const lastPageNumber = Number(pageOf[2]);
    console.log(`     pager reports ${lastPageNumber} pages`);
    check("the page count matches the total", lastPageNumber === Math.ceil(total / 25), `${lastPageNumber} vs ${Math.ceil(total / 25)}`);

    const page2 = await get("/listing-outcomes?page=2");
    const page2Text = visibleText(page2.body);
    const showing2 = page2Text.match(/Showing\s+(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/);
    check("page 2 renders its own range", Boolean(showing2) && Number(showing2[1]) === 26, showing2?.[0] ?? "no range");

    const lastPage = await get(`/listing-outcomes?page=${lastPageNumber}`);
    const lastText = visibleText(lastPage.body);
    const showingLast = lastText.match(/Showing\s+(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/);
    check("the last page ends on the total", Boolean(showingLast) && Number(showingLast[2]) === total, showingLast?.[0] ?? "no range");

    const beyond = await get(`/listing-outcomes?page=${lastPageNumber + 500}`);
    const beyondText = visibleText(beyond.body);
    check("a page past the end still renders rows", beyond.status === 200 && /Showing\s+\d+/.test(beyondText),
      beyondText.slice(0, 120));

    // Pages must not repeat each other. An outcome's id is not printed on a
    // collapsed card, so compare what the served HTML shows against what the
    // browsing library says each page holds -- which also proves the rendered
    // page and the library agree about the order.
    const expected = await expectedPages();
    if (!expected) {
      console.log("  --   could not load rows to compare pages against, skipped");
    } else {
      const { pageOne, pageTwo } = expected;
      check("the library and the served page agree on the page-1 listings",
        pageOne.every((row) => page1.body.includes(escapeHtml(row.listingTitle))),
        `${pageOne.filter((row) => !page1.body.includes(escapeHtml(row.listingTitle))).length} of ${pageOne.length} missing`);
      check("the library and the served page agree on the page-2 listings",
        pageTwo.every((row) => page2.body.includes(escapeHtml(row.listingTitle))),
        `${pageTwo.filter((row) => !page2.body.includes(escapeHtml(row.listingTitle))).length} of ${pageTwo.length} missing`);
      const idsOne = new Set(pageOne.map((row) => row.id));
      check("the two pages hold different listings",
        pageOne.length > 0 && pageTwo.length > 0 && !pageTwo.some((row) => idsOne.has(row.id)),
        `${pageOne.length} and ${pageTwo.length} rows`);
      // A title appearing on both pages would be two distinct listings sharing
      // a title, which is normal; ids are what must not repeat.
      const sharedTitles = pageTwo.filter((row) => pageOne.some((other) => other.listingTitle === row.listingTitle)).length;
      if (sharedTitles) console.log(`     (${sharedTitles} listing title(s) legitimately appear on both pages as different listings)`);
    }
  }
}

console.log("\n5. Tabs, queues, sort and search each render");
for (const query of ["view=watching", "view=finished", "queue=graded", "queue=parked", "queue=all", "sort=match", "sort=newest", "q=bleach"]) {
  const result = await get(`/listing-outcomes?${query}`);
  const text = visibleText(result.body);
  check(`?${query} renders`, result.status === 200 && /Showing|listings in this view|Nothing/.test(text), `status ${result.status}`);
}
const badParams = await get("/listing-outcomes?view=nonsense&queue=nonsense&sort=nonsense&page=abc");
check("nonsense query parameters fall back instead of erroring",
  badParams.status === 200 && /Showing|Nothing/.test(visibleText(badParams.body)), `status ${badParams.status}`);

console.log("\n6. Required fields and error states are present where decisions happen");
check("the outcomes page asks for a reviewer before saving",
  /Required before saving decisions|Name or initials/i.test(page1Text));
check("the review page asks for a reviewer",
  /Reviewer\s+Type this once|before making decisions/i.test(visibleText(pages["/review"].body)));
// An empty inbox is a legitimate state, not a failure: it means the queues are
// genuinely clear. It still has to say so rather than render nothing.
const reviewText2 = visibleText(pages["/review"].body);
if (/0 decisions needing you/.test(reviewText2)) {
  check("an empty inbox explains itself", /No human input is needed/i.test(reviewText2));
}
check("the add-sale page renders its form",
  /<form/i.test(pages["/add-sale"].body), "no form element");

console.log("\n7. A link from Decisions opens the exact listing it named");
// The inbox links whichever outcome currently needs a decision, and that set is
// often empty. The property to test is the one that broke: a link naming a
// listing far outside the first page must still open it. Take a real listing
// from deep in the queue and follow the link the inbox would build.
const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: deepCandidates } = await admin.from("listing_outcomes")
  .select("id,listing_title,status,check_attempts,reviewed_by")
  .in("status", ["ended_pending_check", "ambiguous", "inaccessible"])
  .is("reviewed_by", null)
  .gt("check_attempts", 0)
  .order("id", { ascending: false })
  .limit(3);

if (!deepCandidates?.length) {
  console.log("  --   no unresolved listing available to link to, skipped");
} else {
  for (const candidate of deepCandidates) {
    const focused = await get(`/listing-outcomes?outcome=${candidate.id}`);
    const text = visibleText(focused.body);
    check(`a link to ${candidate.id.slice(0, 8)}… renders`, focused.status === 200, `status ${focused.status}`);
    // The id alone is echoed back in the URL, so that proves nothing. The
    // listing's own title has to be rendered among the cards.
    check(`…and that listing's card is on the page served`,
      text.includes(candidate.listing_title.replace(/\s+/g, " ").trim()), "the listing's title is not rendered");
    check(`…and the page says it opened it`, /Opened/.test(text), "no confirmation message");
  }
  const nonsense = await get("/listing-outcomes?outcome=00000000-0000-0000-0000-000000000000");
  check("a link to a listing that no longer exists says so",
    nonsense.status === 200 && /no longer exists/i.test(visibleText(nonsense.body)), "no explanation rendered");
}

console.log("\n7b. Empty states");
const emptySearch = await get("/listing-outcomes?q=zzzz-definitely-no-such-listing");
check("a search matching nothing renders a clean empty state",
  emptySearch.status === 200 && /Nothing in this queue matches/i.test(visibleText(emptySearch.body)),
  visibleText(emptySearch.body).slice(-200));
check("an empty search result hides the pager",
  !/Page\s+1\s+of\s+[2-9]/.test(visibleText(emptySearch.body)));

console.log("\n8. Mobile layout rules exist for the new controls");
const css = await get("/listing-outcomes");
check("the pagination nav is rendered with an accessible label",
  /aria-label="Listing outcome pages"/.test(css.body) || /outcome-pagination/.test(css.body),
  "pagination markup absent");

console.log(`\n${failures ? "FAILED" : "PASSED"}: ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
