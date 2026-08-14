import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isStaffRequest } from "@/lib/staffSession";
import { findActiveEbayListings, getEbayApplicationToken } from "@/lib/ebayScout";
import { looksGraded, parseIssueReference, splitIssueNumbers } from "@/lib/editionMatch";

// Attaches a photograph of a real copy to a pending magazine candidate, so a
// reviewer can see the issue on the review page instead of taking the record
// on trust.
//
// This exists because a magazine cannot be seen any other way. Jump cover art
// is Shueisha's copyright, so no bibliographic source publishes a picture:
// the Media Arts Database has no image field at all, and cover discovery is
// keyed on ISBN, which a magazine has none of. Every external link tried so
// far failed for the reviewer -- a page that renders blank, a library holding
// an exact record for 1 issue in 13, and a marketplace that refuses EU and UK
// visitors. A photo held here depends on none of that.
//
// What this is NOT: a cover. Marketplace listing photos are explicitly
// excluded from cover verification (see 20260731_cover_image_provenance.sql),
// and nothing here touches cover_image_url or any cover column. It is a
// review aid and is stored as one.
//
// It also never guesses. A photo is only attached when the listing's own
// title names the same magazine year and issue number as the candidate, so a
// wrong picture -- worse than none -- cannot be attached by a near miss.

export const dynamic = "force-dynamic";

type Candidate = {
  id: string;
  candidate_volume_number: string | null;
  raw_payload: {
    review_metadata?: { issue_year?: string; issue_number_label?: string; cumulative_issue_no?: string };
    catalogue_series_matched?: string[] | null;
    listing_photo?: unknown;
  } | null;
};

// "Weekly Shonen Jump 1997 34" hands eBay two loose numbers and returns
// noise. Worse, a listing titled that way cannot be confirmed either -- the
// reader below needs "issue", "no." or "#" in front of the number before it
// will believe a number is an issue at all, because ten real listings in the
// Scout queue say "Vol 1 Issue 1" meaning volume one. So the search asks for
// the same shape the matcher can actually verify.
//
// The series name is added last where one is known -- sellers name it on
// every issue anyone cares about.
//
// It must be the catalogue's own series name ("One Piece"), never the raw
// contents entry from the source. Those entries are whatever the magazine
// printed in its table of contents, which for 2016年30号 is
// 「ONE PIECE」公式スピンオフコメディ!!「ワンピースパーティー」JC2巻発売記念SP漫画劇場!! --
// a promotional headline for a spin-off, pasted straight into a search box.
// Anything that long or punctuated is a feature title, not a series, so it is
// rejected outright as a second line of defence.
function usableSeriesName(value: string | null | undefined) {
  const name = String(value ?? "").trim();
  if (name.length < 2 || name.length > 30) return null;
  if (/[「」『』!！?？。、,]|\d{2,}/.test(name)) return null;
  return name;
}

function buildQueries(year: number, issueLabel: string, seriesNames: string[]) {
  const queries = [
    `週刊少年ジャンプ ${year}年${issueLabel}号`,
    `Weekly Shonen Jump ${year} issue ${issueLabel}`,
    `Shonen Jump ${year} #${issueLabel}`,
  ];
  const series = seriesNames.map(usableSeriesName).find(Boolean);
  if (series) {
    queries.push(`Weekly Shonen Jump ${year} issue ${issueLabel} ${series}`);
    queries.push(`週刊少年ジャンプ ${year}年${issueLabel}号 ${series}`);
  }
  return queries;
}

type Attached = {
  issue: string;
  listingTitle: string;
  imageUrl: string;
  listingUrl: string;
  graded: boolean;
};

function confirmsIssue(listingTitle: string, year: number, issueNumbers: number[]) {
  const reference = parseIssueReference(listingTitle);
  if (reference.looksLikeBook) return false;
  if (reference.year !== year) return false;
  return reference.issueNumbers.some((number) => issueNumbers.includes(number));
}

export async function POST(request: Request) {
  if (!await isStaffRequest(request)) {
    return Response.json({ error: "Staff access is required." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: source } = await admin.from("sources").select("id").eq("name", "Media Arts Database").maybeSingle();
  if (!source) return Response.json({ error: "The Media Arts Database source is not registered." }, { status: 400 });

  const { data } = await admin
    .from("catalogue_import_queue")
    .select("id, candidate_volume_number, raw_payload")
    .eq("source_id", source.id)
    .eq("status", "pending_review")
    .limit(100);

  const candidates = (data ?? []) as Candidate[];
  const attached: Attached[] = [];
  const unmatched: string[] = [];
  const errors: string[] = [];
  let applicationToken: string;
  try {
    applicationToken = await getEbayApplicationToken();
  } catch {
    return Response.json({ error: "eBay did not issue RAR an application token." }, { status: 503 });
  }

  for (const candidate of candidates) {
    const metadata = candidate.raw_payload?.review_metadata;
    const year = Number(metadata?.issue_year);
    const issueLabel = String(metadata?.issue_number_label ?? "").trim();
    const issueNumbers = splitIssueNumbers(issueLabel);
    const label = candidate.candidate_volume_number ?? candidate.id;
    if (!Number.isInteger(year) || !issueNumbers.length) {
      unmatched.push(`${label} — no usable year/issue on the candidate`);
      continue;
    }
    // Already has a raw photo -- leave it alone. A graded one is retried, so
    // an earlier run that could only find a slab gets upgraded if a loose
    // copy has since been listed.
    const existing = candidate.raw_payload?.listing_photo as { graded?: boolean } | undefined;
    if (existing && existing.graded === false) continue;

    const queries = buildQueries(year, issueLabel, candidate.raw_payload?.catalogue_series_matched ?? []);
    // A raw copy is a better look at a magazine than a slab, where the cover
    // sits behind plastic under a grader's label. Both searches are run and
    // every confirmed listing collected before choosing, so a raw copy found
    // by the second query still beats a graded one found by the first. A slab
    // is used only when nothing else was found -- some picture beats none.
    const confirmed: Attached[] = [];
    for (const query of queries) {
      // Queries run best-first, so once a loose copy is confirmed there is
      // nothing better to find and the remaining searches are skipped.
      if (confirmed.some((found) => !found.graded)) break;
      try {
        const listings = await findActiveEbayListings(query, applicationToken);
        for (const listing of listings) {
          if (!listing.imageUrl || !confirmsIssue(listing.title, year, issueNumbers)) continue;
          confirmed.push({
            issue: label,
            listingTitle: listing.title,
            imageUrl: listing.imageUrl,
            listingUrl: listing.url,
            graded: looksGraded(listing.title),
          });
        }
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : "eBay search failed"}`);
      }
    }
    const match = confirmed.find((candidateMatch) => !candidateMatch.graded) ?? confirmed[0] ?? null;

    if (!match) { unmatched.push(label); continue; }

    const payload = {
      ...(candidate.raw_payload ?? {}),
      listing_photo: {
        image_url: match.imageUrl,
        listing_url: match.listingUrl,
        listing_title: match.listingTitle,
        graded: match.graded,
        captured_at: new Date().toISOString(),
        // Stated on the record itself so it cannot drift into being treated
        // as provenance for a cover.
        note: "A copy offered for sale, shown so the issue can be seen. Not a verified cover and never sale evidence.",
      },
    };
    const { error } = await admin.from("catalogue_import_queue").update({ raw_payload: payload }).eq("id", candidate.id);
    if (error) errors.push(`${label}: ${error.message}`);
    else attached.push(match);
  }

  return Response.json({
    checked: candidates.length,
    attached: attached.length,
    // Reported so a run that could only find slabs is visible rather than
    // silently producing hard-to-read thumbnails.
    graded: attached.filter((photo) => photo.graded).length,
    photos: attached,
    noListingFound: unmatched,
    errors,
  });
}
