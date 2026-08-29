import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import ScoutBatchRunButton from "@/components/ScoutBatchRunButton";
import ScoutRunButton from "@/components/ScoutRunButton";
import ScoutTriageInbox, { type ScoutLead } from "@/components/ScoutTriageInbox";
import StaffNav from "@/components/StaffNav";
import { assessScoutListing, type ScoutEdition } from "@/lib/scoutIngest";
import { scoutListingGroupKey } from "@/lib/scoutGrouping";
import { isScoutLeadStale } from "@/lib/scoutDiagnostics";
import { isPrioritySeries } from "@/lib/prioritySeries";
import { loadActiveScoutRules } from "@/lib/scoutRules";
import { surplusScoutLeadIds } from "@/lib/scoutCoverage";

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
  raw_payload: unknown;
  review_status: "new" | "watching" | "dismissed";
  review_notes: string | null;
  reviewed_by: string | null;
};

// PostgREST caps a single response at 1000 rows regardless of .limit(); a
// working inbox needs every stored lead across every active profile
// (currently ~1,900 and growing), so this fetches in pages rather than
// silently truncating the queue.
async function fetchAllLeads(admin: ReturnType<typeof getSupabaseAdmin>, profileIds: string[]) {
  const pageSize = 1000;
  const rows: LeadRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from("scout_listing_leads")
      .select("id,profile_id,source_id,external_id,source_listing_url,listing_title,listing_price,currency,listing_condition,item_end_at,first_seen_at,last_seen_at,raw_payload,review_status,review_notes,reviewed_by")
      .in("profile_id", profileIds)
      .order("last_seen_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error || !data) break;
    rows.push(...(data as LeadRow[]));
    if (data.length < pageSize) break;
  }
  return rows;
}

export default async function ScoutPage() {
  const admin = getSupabaseAdmin();
  const { data: profileData } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,last_checked_at,edition_id,edition:manga_editions(id,title,series,volume_number,language,isbn_13,publisher,format,printing_number,edition_statement,variant_name,collectible_type,issue_year,issue_number_label,cumulative_issue_no),source:sources(name)")
    .eq("is_active", true)
    .order("last_checked_at", { ascending: false, nullsFirst: false });
  const profiles = (profileData ?? []) as unknown as Profile[];
  const profileIds = profiles.map((profile) => profile.id);
  const editionByProfile = new Map(profiles.map((profile) => [profile.id, profile.edition]));
  const activeRules = await loadActiveScoutRules(admin);

  const leadRows = profileIds.length ? await fetchAllLeads(admin, profileIds) : [];
  const { count: autoDismissedCount } = profileIds.length
    ? await admin.from("scout_listing_leads").select("id", { count: "exact", head: true }).in("profile_id", profileIds).eq("reviewed_by", "RAR Auto-Triage")
    : { count: 0 };

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
      rawPayload: primary.raw_payload,
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
      duplicateCount: otherProfiles.length,
      duplicateProfiles: otherProfiles,
    });
  }

  const surplusLeadIds = surplusScoutLeadIds(leads);
  const prioritisedLeads = leads.map((lead) => ({ ...lead, isSurplusBackup: surplusLeadIds.has(lead.id) }));

  return (
    <main className="review-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard →</Link>
        <Link className="header-note" href="/collection-profiles">Collection profiles →</Link>
        <StaffNav current="/scout" />
      </header>
      <section className="review-hero">
        <div>
          <p className="eyebrow">RAR Scout</p>
          <h1>Scout triage inbox</h1>
          <p>Scout finds currently available listings using the official eBay Browse API. These are research leads only: they never enter sales history, valuation, or charts. Definitive edition conflicts are safely archived, stale leads are separated from the current queue, and a bounded availability refresh rechecks old records directly with eBay. No agent can verify a sale or overwrite a staff decision ({autoDismissedCount ?? 0} earlier ingestion conflicts archived).</p>
          <ScoutBatchRunButton />
        </div>
        {/* Dismissed leads are decisions already made, not work outstanding.
            Counting them made the queue read as 3,000+ when 1,176 were
            actually open, which is the difference between a backlog someone
            starts and one they avoid. They stay fetched and stay reachable
            through the Dismissed filter. */}
        <div className="queue-total"><strong>{prioritisedLeads.filter((lead) => lead.reviewStatus !== "dismissed" && !lead.isSurplusBackup).length}</strong><span>priority listings across {profiles.length} profiles · {surplusLeadIds.size} backups separated</span></div>
      </section>
      <section className="catalogue-content">
        <ScoutTriageInbox leads={prioritisedLeads} />

        <details className="profile-editor scout-profile-scan">
          <summary><span>Scan one profile on demand</span><small>{profiles.length} active search profiles</small></summary>
          {profiles.length ? (
            <div className="review-list scout-profile-list">
              {profiles.map((profile) => (
                <div className="scout-profile-row" key={profile.id}>
                  <div>
                    <strong>{profile.edition?.title ?? "Edition"}</strong>
                    <small>{[profile.edition?.language, profile.edition?.isbn_13 ? `ISBN ${profile.edition.isbn_13}` : null, profile.source?.name].filter(Boolean).join(" · ")} · {formatLastChecked(profile.last_checked_at)}</small>
                  </div>
                  <ScoutRunButton profileId={profile.id} />
                </div>
              ))}
            </div>
          ) : <p>No active profiles yet. Create an exact-edition eBay profile before Scout can run.</p>}
        </details>
      </section>
    </main>
  );
}
