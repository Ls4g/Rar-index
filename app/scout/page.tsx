import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import ScoutBatchRunButton from "@/components/ScoutBatchRunButton";
import ScoutTriageInbox, { type ScoutLead } from "@/components/ScoutTriageInbox";
import StaffNav from "@/components/StaffNav";
import { assessScoutListing, type ScoutEdition } from "@/lib/scoutIngest";
import { scoutListingGroupKey } from "@/lib/scoutGrouping";
import { isScoutLeadStale } from "@/lib/scoutDiagnostics";
import { isPrioritySeries } from "@/lib/prioritySeries";
import { loadActiveScoutRules } from "@/lib/scoutRules";
import { surplusScoutLeadIds } from "@/lib/scoutCoverage";
import { looksGraded } from "@/lib/editionMatch";
import { listingType } from "@/lib/liveListings";
import { readHumanScoutDecisions } from "@/lib/scoutFeedback";
import { createScoutMemory } from "@/lib/scoutLearningEvidence";
import { isScoutView, matchesScoutView, SCOUT_VIEW_KEYS } from "@/lib/scoutInboxView";
import ScoutProfileScans from "@/components/ScoutProfileScans";

function formatLastChecked(value: string | null) {
  if (!value) return "Never scanned";
  return `Last scanned ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value))}`;
}

export const dynamic = "force-dynamic";

// A plain top-level helper rather than an inline Date.now() inside the page
// component — this route runs once per request (force-dynamic), but the
// current-time read still needs to sit outside the component body itself.
function currentTimeMs() {
  return Date.now();
}

type Profile = {
  id: string;
  search_query: string;
  last_checked_at: string | null;
  edition_id: string;
  edition: (ScoutEdition & { id: string }) | null;
  source: { name: string | null } | null;
};

type LeadRow = {
  id: string;
  profile_id: string;
  source_id: string;
  external_id: string;
  source_listing_url: string;
  listing_title: string;
  listing_price: number | null;
  currency: string | null;
  listing_condition: string | null;
  item_end_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  buying_options: string[] | null;
  review_status: "new" | "watching" | "dismissed";
  review_notes: string | null;
  reviewed_by: string | null;
};

// PostgREST caps a single response at 1000 rows regardless of .limit().
// Current leads are read in narrow pages so every view count and coverage
// backup stays accurate; dismissed history is read only one page at a time.
const SCOUT_PAGE_SIZE = 250;

async function fetchLeads(admin: ReturnType<typeof getSupabaseAdmin>, profileIds: string[], archivePage: number | null) {
  const pageSize = 1000;
  const rows: LeadRow[] = [];
  const archive = archivePage !== null;
  const start = archive ? archivePage * SCOUT_PAGE_SIZE : 0;
  async function readPage(offset: number, last: number) {
    let query = admin
      .from("scout_listing_leads")
      .select("id,profile_id,source_id,external_id,source_listing_url,listing_title,listing_price,currency,listing_condition,item_end_at,first_seen_at,last_seen_at,buying_options:raw_payload->item->buyingOptions,review_status,review_notes,reviewed_by")
      .in("profile_id", profileIds)
      .order("last_seen_at", { ascending: false })
      .order("id", { ascending: true })
      .range(offset, last);
    query = archive ? query.eq("review_status", "dismissed") : query.in("review_status", ["new", "watching"]);
    const { data, error } = await query;
    if (error) throw new Error(`Scout leads could not be loaded: ${error.message}`);
    return (data ?? []) as LeadRow[];
  }
  if (archive) {
    rows.push(...await readPage(start, start + SCOUT_PAGE_SIZE));
  } else {
    // Four narrow pages in parallel instead of serialising every database
    // round trip. Stop at the first short page; later pages are empty.
    const concurrency = 4;
    for (let offset = 0; ; offset += pageSize * concurrency) {
      const pages = await Promise.all(Array.from({ length: concurrency }, (_, index) =>
        readPage(offset + index * pageSize, offset + (index + 1) * pageSize - 1)));
      for (const batch of pages) rows.push(...batch);
      if (pages.some((batch) => batch.length < pageSize)) break;
    }
  }
  return { rows: archive ? rows.slice(0, SCOUT_PAGE_SIZE) : rows, hasMore: archive && rows.length > SCOUT_PAGE_SIZE };
}

export default async function ScoutPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const parameters = await searchParams;
  const view = isScoutView(parameters.view) ? parameters.view : "reviewNow";
  const archiveView = view === "dismissed";
  const parsedPage = Number(parameters.page ?? "1");
  const pageIndex = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? Math.min(parsedPage - 1, 1000) : 0;
  const admin = getSupabaseAdmin();
  const rulesPromise = loadActiveScoutRules(admin);
  // Only the visible page needs nearby staff examples. The full history
  // remains available to agent learning, but cannot block this inbox.
  const memoryPromise = archiveView ? null : readHumanScoutDecisions(admin, 250)
    .then((decisions) => ({ find: createScoutMemory(decisions), ready: true }))
    .catch(() => ({ find: createScoutMemory([]), ready: false }));
  const { data: profileData } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,last_checked_at,edition_id,edition:manga_editions(id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no),source:sources(name)")
    .eq("is_active", true)
    .order("last_checked_at", { ascending: false, nullsFirst: false });
  const profiles = (profileData ?? []) as unknown as Profile[];
  const profileIds = profiles.map((profile) => profile.id);
  const editionByProfile = new Map(profiles.map((profile) => [profile.id, profile.edition]));
  const { rows: leadRows, hasMore: archiveHasMore } = profileIds.length
    ? await fetchLeads(admin, profileIds, archiveView ? pageIndex : null)
    : { rows: [] as LeadRow[], hasMore: false };
  const activeRules = await rulesPromise;

  // The same real eBay listing can be captured by more than one collection
  // profile for the same exact RAR edition. Each profile relationship stays a separate row in
  // scout_listing_leads (and a separate audit trail on decision) — this
  // only groups them for display, and for applying one decision to the
  // same-edition cluster at once so staff never triage the same listing twice.
  // The edition ID is part of the key: one listing matched to two different
  // editions must receive two independent decisions.
  const groupsByListing = new Map<string, LeadRow[]>();
  for (const lead of leadRows) {
    const edition = editionByProfile.get(lead.profile_id);
    const key = scoutListingGroupKey(lead.source_id, lead.external_id, edition?.id, lead.profile_id);
    const group = groupsByListing.get(key) ?? [];
    group.push(lead);
    groupsByListing.set(key, group);
  }

  const now = currentTimeMs();
  const leads: ScoutLead[] = [];
  const listingKeys = new Map<string, string>();
  for (const group of groupsByListing.values()) {
    const primary = group.find((lead) => lead.review_status === "new") ?? group[0];
    const edition = editionByProfile.get(primary.profile_id);
    if (!edition) continue;
    const assessment = assessScoutListing(edition, primary.listing_title, activeRules);
    const otherProfiles = group
      .filter((lead) => lead.id !== primary.id)
      .flatMap((lead) => {
        const otherEdition = editionByProfile.get(lead.profile_id);
        return otherEdition ? [{ profileId: lead.profile_id, editionId: otherEdition.id, editionLabel: [otherEdition.series || otherEdition.title, otherEdition.volume_number ? `Vol. ${otherEdition.volume_number}` : null, otherEdition.language].filter(Boolean).join(" · ") }] : [];
      });

    listingKeys.set(primary.id, `${primary.source_id}:${primary.external_id}`);
    leads.push({
      id: primary.id,
      leadIds: group.map((lead) => lead.id),
      profileId: primary.profile_id,
      editionId: edition.id,
      editionTitle: edition.title,
      series: edition.series,
      volumeNumber: edition.volume_number === null ? null : String(edition.volume_number),
      language: edition.language,
      isbn13: edition.isbn_13,
      publisher: edition.publisher,
      sourceListingUrl: primary.source_listing_url,
      listingTitle: primary.listing_title,
      listingPrice: primary.listing_price,
      currency: primary.currency,
      itemEndAt: primary.item_end_at,
      firstSeenAt: primary.first_seen_at,
      lastSeenAt: primary.last_seen_at,
      listingType: listingType({ item: { buyingOptions: primary.buying_options } }),
      score: assessment.score,
      confidence: assessment.confidence,
      reasons: assessment.reasons,
      conflicts: assessment.conflicts,
      reviewStatus: primary.review_status,
      reviewNotes: primary.review_notes,
      reviewedBy: primary.reviewed_by,
      isPriority: isPrioritySeries(edition.series),
      isExpired: Boolean(primary.item_end_at) && new Date(primary.item_end_at as string).getTime() < now,
      isStale: isScoutLeadStale(primary.last_seen_at, now),
      isSurplusBackup: false,
      isGraded: looksGraded(primary.listing_title),
      duplicateCount: otherProfiles.length,
      duplicateProfiles: otherProfiles,
    });
  }

  const surplusLeadIds = surplusScoutLeadIds(leads);
  const prioritisedLeads = leads.map((lead) => ({ ...lead, isSurplusBackup: surplusLeadIds.has(lead.id) }));
  const counts = Object.fromEntries(SCOUT_VIEW_KEYS.map((key) =>
    [key, prioritisedLeads.filter((lead) => matchesScoutView(lead, key, now)).length])) as Record<typeof SCOUT_VIEW_KEYS[number], number>;
  const candidates = archiveView ? prioritisedLeads : prioritisedLeads.filter((lead) => matchesScoutView(lead, view, now));
  candidates.sort((left, right) => {
    if (view === "endsSoon") return Date.parse(left.itemEndAt ?? "") - Date.parse(right.itemEndAt ?? "");
    return right.score - left.score || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
  });
  const pageLeads = archiveView ? candidates : candidates.slice(pageIndex * SCOUT_PAGE_SIZE, (pageIndex + 1) * SCOUT_PAGE_SIZE);
  const hasMore = archiveView ? archiveHasMore : candidates.length > (pageIndex + 1) * SCOUT_PAGE_SIZE;
  const memoryResult = memoryPromise ? await memoryPromise : { find: createScoutMemory([]), ready: true };
  for (const lead of pageLeads) {
    if (lead.reviewStatus !== "new") continue;
    const edition = editionByProfile.get(lead.profileId);
    if (edition) lead.relatedDecisions = memoryResult.find(edition, lead.listingTitle, lead.leadIds, listingKeys.get(lead.id));
  }
  const pageLink = (index: number) => `/scout?view=${view}&page=${index + 1}`;

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard →</Link>
        <Link className="header-note" href="/collection-profiles">Collection profiles →</Link>
        <Link className="header-note" href="/graded-revisit">Graded copies to revisit →</Link>
        <StaffNav current="/scout" />
      </header>
      <section className="review-hero">
        <div>
          <p className="eyebrow">RAR Scout</p>
          <h1>{archiveView ? "Scout decision archive" : "Scout triage inbox"}</h1>
          <p>Scout finds currently available listings using the official eBay Browse API. These are research leads only: they never enter sales history, valuation, or charts. Dismissed listings and prior decisions stay in a separate archive; they no longer hold up the current inbox. No agent can verify a sale or overwrite a staff decision.</p>
          <Link className="staff-health-link" href="/graded-revisit">Review previously dismissed graded copies →</Link>
          {!archiveView ? <ScoutBatchRunButton /> : <Link className="staff-health-link" href="/scout">← Current Scout inbox</Link>}
        </div>
        <div className="queue-total"><strong>{archiveView ? pageLeads.length : candidates.length}</strong><span>{archiveView ? `archived listings on page ${pageIndex + 1}` : `listings in this view across ${profiles.length} profiles · page ${pageIndex + 1}`}</span></div>
      </section>
      <section className="catalogue-content">
        {!memoryResult.ready ? <p role="status">Past decision examples are temporarily unavailable. You can still review listings.</p> : null}
        <ScoutTriageInbox archiveView={archiveView} key={`${view}-${pageIndex}`} leads={pageLeads} selectedView={view} viewCounts={counts} viewTotal={archiveView ? null : candidates.length} />
        <nav aria-label="Scout inbox pages" className="scout-archive-pages">
          {pageIndex > 0 ? <Link href={pageLink(pageIndex - 1)}>← Newer listings</Link> : null}
          {hasMore ? <Link href={pageLink(pageIndex + 1)}>Older listings →</Link> : null}
        </nav>

        {!archiveView ? <ScoutProfileScans profiles={profiles.map((profile) => ({
          id: profile.id,
          title: profile.edition?.title ?? "Edition",
          language: profile.edition?.language ?? null,
          isbn: profile.edition?.isbn_13 ?? null,
          source: profile.source?.name ?? null,
          lastChecked: formatLastChecked(profile.last_checked_at),
        }))} /> : null}
      </section>
    </main>
  );
}
