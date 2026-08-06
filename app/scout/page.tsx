import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import ScoutBatchRunButton from "@/components/ScoutBatchRunButton";
import ScoutRunButton from "@/components/ScoutRunButton";
import ScoutTriageInbox, { type ScoutLead } from "@/components/ScoutTriageInbox";
import { assessScoutListing, type ScoutEdition } from "@/lib/scoutIngest";
import { isPrioritySeries } from "@/lib/prioritySeries";

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
    .select("id,search_query,last_checked_at,edition_id,edition:manga_editions(id,title,series,volume_number,language,isbn_13,publisher,format),source:sources(name)")
    .eq("is_active", true)
    .order("last_checked_at", { ascending: false, nullsFirst: false });
  const profiles = (profileData ?? []) as unknown as Profile[];
  const profileIds = profiles.map((profile) => profile.id);
  const editionByProfile = new Map(profiles.map((profile) => [profile.id, profile.edition]));

  const leadRows = profileIds.length ? await fetchAllLeads(admin, profileIds) : [];
  const { count: autoDismissedCount } = profileIds.length
    ? await admin.from("scout_listing_leads").select("id", { count: "exact", head: true }).in("profile_id", profileIds).eq("reviewed_by", "RAR Auto-Triage")
    : { count: 0 };

  // The same real eBay listing can be captured by more than one collection
  // profile (e.g. a raw-copy profile and a graded-copy profile both scoping
  // to "Bleach Vol. 1"). Each profile relationship stays a separate row in
  // scout_listing_leads (and a separate audit trail on decision) — this
  // only groups them for display, and for applying one decision to the
  // whole cluster at once so staff never triage the same listing twice.
  const groupsByListing = new Map<string, LeadRow[]>();
  for (const lead of leadRows) {
    const key = `${lead.source_id}:${lead.external_id}`;
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
    const assessment = assessScoutListing(edition, primary.listing_title);
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
      duplicateCount: otherProfiles.length,
      duplicateProfiles: otherProfiles,
    });
  }

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard →</Link>
        <Link className="header-note" href="/collection-profiles">Collection profiles →</Link>
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">RAR Scout</p>
          <h1>Scout triage inbox</h1>
          <p>Scout finds currently available listings using the official eBay Browse API. These are research leads only: they never enter sales history, valuation, or charts. On every scan, RAR Auto-Triage dismisses leads that are a multi-volume lot/set, name a different volume, or whose title text clearly conflicts with the target edition&apos;s ISBN, publisher, language, or binding ({autoDismissedCount ?? 0} dismissed so far) — it never touches a lead a staff member has already reviewed, and it never verifies a sale.</p>
          <ScoutBatchRunButton />
        </div>
        <div className="queue-total"><strong>{leads.length}</strong><span>unique active listings across {profiles.length} profiles</span></div>
      </section>
      <section className="catalogue-content">
        <ScoutTriageInbox leads={leads} />

        <details className="profile-editor scout-profile-scan">
          <summary><span>Scan one profile on demand</span><small>{profiles.length} active search profiles</small></summary>
          {profiles.length ? (
            <div className="review-list scout-profile-list">
              {profiles.map((profile) => (
                <div className="scout-profile-row" key={profile.id}>
                  <div>
                    <strong>{profile.edition?.title ?? "Edition"}</strong>
                    <small>{[profile.edition?.language, profile.edition?.isbn_13 ? `ISBN ${profile.edition.isbn_13}` : null, profile.source?.name].filter(Boolean).join(" · ")}</small>
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
