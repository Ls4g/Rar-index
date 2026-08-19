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

// eBay's search API returns a 225px thumbnail, which is soft in a 268px cover
// slot and unusable on a retina screen. The same photograph is served at other
// sizes by swapping the suffix, so ask for one that suits the slot: 800px is
// 143KB against 375KB for the largest, and nothing here is displayed bigger.
function upgradeImageSize(url: string) {
  return url.replace(/\/s-l\d+\.(jpg|jpeg|png|webp)$/i, "/s-l800.$1");
}

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
            imageUrl: upgradeImageSize(listing.imageUrl),
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

  // Catalogued magazines get one too, shown where a cover would be. A
  // magazine has no cover art in any licensed source, so without this its
  // page is permanently blank where every book has a picture.
  //
  // It is never written to a cover column. cover_verification_status stays
  // whatever it was -- 'missing', for every magazine -- so coverage figures
  // stay honest and the rule excluding marketplace photos from cover
  // verification is untouched.
  const { data: editionData } = await admin
    .from("manga_editions")
    .select("id, volume_number, issue_year, issue_number_label, listing_photo_url, listing_photo_is_graded")
    .eq("collectible_type", "zasshi")
    .limit(200);

  // The series that debuted in each issue, so the search can name it. Nobody
  // lists a 1984 Jump without writing "Dragon Ball" somewhere in the title,
  // and a 41-year-old magazine is hard enough to find without throwing away
  // the strongest term available.
  const { data: debutData } = await admin
    .from("magazine_issue_contents")
    .select("edition_id, work_title_en, work_title")
    .eq("is_first_appearance", true);
  const debutsByEdition = new Map<string, string[]>();
  for (const row of debutData ?? []) {
    const name = (row.work_title_en ?? row.work_title ?? "").replace(/[　\s]+/g, " ").trim();
    if (!name) continue;
    const list = debutsByEdition.get(row.edition_id) ?? [];
    if (!list.includes(name)) list.push(name);
    debutsByEdition.set(row.edition_id, list);
  }

  for (const record of editionData ?? []) {
    const year = Number(record.issue_year);
    const issueNumbers = splitIssueNumbers(String(record.issue_number_label ?? ""));
    const label = record.volume_number ?? record.id;
    if (!Number.isInteger(year) || !issueNumbers.length) continue;
    // A raw photo already in place is left alone; a graded one is retried, so
    // a slab gets replaced once a loose copy is listed.
    if (record.listing_photo_url && record.listing_photo_is_graded === false) continue;

    const queries = buildQueries(year, String(record.issue_number_label ?? ""), debutsByEdition.get(record.id) ?? []);
    const found: Attached[] = [];
    let seen = 0;
    for (const query of queries) {
      if (found.some((entry) => !entry.graded)) break;
      try {
        const listings = await findActiveEbayListings(query, applicationToken);
        seen += listings.length;
        for (const listing of listings) {
          if (!listing.imageUrl || !confirmsIssue(listing.title, year, issueNumbers)) continue;
          found.push({ issue: label, listingTitle: listing.title, imageUrl: upgradeImageSize(listing.imageUrl), listingUrl: listing.url, graded: looksGraded(listing.title) });
        }
      } catch (error) {
        errors.push(`${label}: ${error instanceof Error ? error.message : "eBay search failed"}`);
      }
    }
    const chosen = found.find((entry) => !entry.graded) ?? found[0] ?? null;
    if (!chosen) {
      // Says which it was. "Nobody is selling this issue" and "listings exist
      // but none names the issue clearly enough to trust" are different
      // problems, and only the second one is worth me looking at.
      unmatched.push(seen === 0
        ? `${label} — nothing on eBay for any of ${queries.length} searches`
        : `${label} — ${seen} listings found, none confirmed the year and issue number`);
      continue;
    }

    const { error } = await admin.from("manga_editions").update({
      listing_photo_url: chosen.imageUrl,
      listing_photo_listing_url: chosen.listingUrl,
      listing_photo_is_graded: chosen.graded,
      listing_photo_captured_at: new Date().toISOString(),
    }).eq("id", record.id);
    if (error) errors.push(`${label}: ${error.message}`);
    else attached.push(chosen);
  }

  return Response.json({
    checked: candidates.length + (editionData?.length ?? 0),
    attached: attached.length,
    // Reported so a run that could only find slabs is visible rather than
    // silently producing hard-to-read thumbnails.
    graded: attached.filter((photo) => photo.graded).length,
    photos: attached,
    noListingFound: unmatched,
    errors,
  });
}
