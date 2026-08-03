import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import CollectionRunForm from "@/components/CollectionRunForm";
import CollectionProfileEditForm from "@/components/CollectionProfileEditForm";

export const dynamic = "force-dynamic";

type Params = { profileId: string };

type Profile = {
  id: string;
  search_query: string;
  scope_notes: string;
  is_active: boolean;
  collection_interval_days: number;
  edition: { id: string; title: string | null; series: string | null; volume_number: string | number | null; language: string | null; isbn_13: string | null } | null;
  source: { name: string | null } | null;
};

type CollectionRun = { id: string; checked_at: string; checked_by: string; candidate_count: number; notes: string };
type SaleStatus = { match_status: "verified_match" | "needs_review" | "excluded"; sale_status: string };
type ScoutLead = { review_status: "new" | "watching" | "dismissed" };
type ProfileRevision = { id: string; changed_at: string; changed_by: string; change_note: string; previous_search_query: string; next_search_query: string; previous_interval_days: number; next_interval_days: number; previous_is_active: boolean; next_is_active: boolean };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function completedSearchUrl(sourceName: string | null, query: string) {
  if (sourceName !== "eBay Sold") return null;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
}

function countBy<T extends string>(rows: { [key: string]: T }[], field: string) {
  return rows.reduce<Record<string, number>>((totals, row) => {
    const key = row[field];
    totals[key] = (totals[key] ?? 0) + 1;
    return totals;
  }, {});
}

export default async function CollectionWorkbenchPage({ params }: { params: Promise<Params> }) {
  const { profileId } = await params;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("marketplace_search_profiles")
    .select("id,search_query,scope_notes,is_active,collection_interval_days,edition:manga_editions(id,title,series,volume_number,language,isbn_13),source:sources(name)")
    .eq("id", profileId)
    .maybeSingle();
  const profile = data as unknown as Profile | null;
  if (!profile?.edition) notFound();

  const [{ data: runData }, { data: saleData }, { data: leadData }, { data: revisionData }] = await Promise.all([
    admin.from("marketplace_collection_runs").select("id,checked_at,checked_by,candidate_count,notes").eq("profile_id", profile.id).order("checked_at", { ascending: false }).limit(12),
    admin.from("price_observations").select("match_status,sale_status").eq("edition_id", profile.edition.id).limit(1000),
    admin.from("scout_listing_leads").select("review_status").eq("profile_id", profile.id).limit(1000),
    admin.from("marketplace_profile_revisions").select("id,changed_at,changed_by,change_note,previous_search_query,next_search_query,previous_interval_days,next_interval_days,previous_is_active,next_is_active").eq("profile_id", profile.id).order("changed_at", { ascending: false }).limit(8),
  ]);
  const runs = (runData ?? []) as CollectionRun[];
  const sales = (saleData ?? []) as SaleStatus[];
  const leads = (leadData ?? []) as ScoutLead[];
  const revisions = (revisionData ?? []) as ProfileRevision[];
  const saleCounts = countBy(sales, "match_status");
  const leadCounts = countBy(leads, "review_status");
  const sourceUrl = completedSearchUrl(profile.source?.name ?? null, profile.search_query);
  const title = [profile.edition.title, profile.edition.volume_number ? `Vol. ${profile.edition.volume_number}` : null, profile.edition.language].filter(Boolean).join(" - ");

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <div className="staff-header-actions">
          <Link className="header-note" href="/collection-profiles">All profiles</Link>
          <Link className="staff-header-primary" href={`/add-sale?editionId=${profile.edition.id}`}>+ Add a sale</Link>
        </div>
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Research workbench</p>
          <h1>{title}</h1>
          <p>This is the controlled path from a marketplace search to a trustworthy RAR sale. A lead or candidate cannot change a valuation by itself.</p>
        </div>
        <div className="queue-total"><strong>{runs.length}</strong><span>recorded collection runs</span></div>
      </section>
      <section className="catalogue-content">
        <div className="section-intro">
          <p className="eyebrow">Exact search specification</p>
          <h2>One profile, one edition</h2>
          <p className="section-copy">{profile.source?.name ?? "Marketplace"} query: <strong>{profile.search_query}</strong>{profile.edition.isbn_13 ? ` | ISBN ${profile.edition.isbn_13}` : ""}</p>
        </div>

        <section className="workbench-action-panel" aria-labelledby="workbench-next-action">
          <div>
            <p className="eyebrow">Next action</p>
            <h2 id="workbench-next-action">Add a completed sale</h2>
            <p>Record a sourced sale for this exact edition. It will stay under review until it is verified or excluded.</p>
          </div>
          <div className="workbench-action-buttons">
            <Link className="staff-action-primary" href={`/add-sale?editionId=${profile.edition.id}`}>+ Add a sale</Link>
            {sourceUrl ? <a className="staff-action-secondary" href={sourceUrl} target="_blank" rel="noreferrer">Open completed search</a> : null}
            <Link className="staff-action-secondary" href="/scout">View Scout leads</Link>
          </div>
        </section>

        <div className="catalogue-rules" aria-label="Research status">
          <div><span>1</span><strong>Collected</strong><p><b>{runs.length}</b> runs recorded. The latest was {runs[0] ? formatDate(runs[0].checked_at) : "not recorded yet"}.</p></div>
          <div><span>2</span><strong>Sales review</strong><p><b>{saleCounts.verified_match ?? 0}</b> verified, <b>{saleCounts.needs_review ?? 0}</b> under review, <b>{saleCounts.excluded ?? 0}</b> excluded.</p></div>
          <div><span>3</span><strong>Active-listing Scout</strong><p><b>{leadCounts.new ?? 0}</b> new leads and <b>{leadCounts.watching ?? 0}</b> watching. Leads are never sales.</p></div>
        </div>

        <section className="review-list-section workbench-section">
          <div className="section-intro"><p className="eyebrow">Operating procedure</p><h2>Repeat the same evidence chain</h2></div>
          <div className="review-steps">
            <div><span>1</span><strong>Open exact search</strong><p>Use the saved query, then count possible completed sales. Do not add listings yet.</p></div>
            <div><span>2</span><strong>Record the run</strong><p>Log who checked, when, and how many candidates were found.</p></div>
            <div><span>3</span><strong>Preflight candidates</strong><p>Import confirmed listings as candidates with source URLs and edition evidence.</p></div>
            <div><span>4</span><strong>Verify or exclude</strong><p>Only a human decision makes a candidate visible in valuation and charts.</p></div>
          </div>
          <div className="review-note"><span>Edition boundary</span><p>{profile.scope_notes}</p></div>
          <CollectionProfileEditForm profileId={profile.id} searchQuery={profile.search_query} scopeNotes={profile.scope_notes} collectionIntervalDays={profile.collection_interval_days} isActive={profile.is_active} />
          <CollectionRunForm profileId={profile.id} />
        </section>

        <section className="review-list-section workbench-section">
          <div className="section-intro"><p className="eyebrow">Run history</p><h2>Traceable collection activity</h2></div>
          {runs.length ? <div className="review-list">{runs.map((run) => <article className="review-card" key={run.id}><div className="review-card-topline"><span>{formatDate(run.checked_at)}</span><span>{run.candidate_count} candidates</span></div><p className="review-condition">Checked by {run.checked_by}</p><div className="review-note"><span>Run note</span><p>{run.notes}</p></div></article>)}</div> : <div className="review-empty"><strong>No completed-listings run recorded.</strong><p>Start with the exact saved search, then record the collection run before importing candidates.</p></div>}
        </section>

        <section className="review-list-section workbench-section">
          <div className="section-intro"><p className="eyebrow">Profile history</p><h2>Search changes stay traceable</h2></div>
          {revisions.length ? <div className="review-list">{revisions.map((revision) => <article className="review-card" key={revision.id}><div className="review-card-topline"><span>{formatDate(revision.changed_at)}</span><span>Updated by {revision.changed_by}</span></div><div className="review-note"><span>Reason</span><p>{revision.change_note}</p></div><dl className="catalogue-details"><div><dt>Previous query</dt><dd>{revision.previous_search_query}</dd></div><div><dt>New query</dt><dd>{revision.next_search_query}</dd></div><div><dt>Cadence</dt><dd>{revision.previous_interval_days} days → {revision.next_interval_days} days</dd></div><div><dt>State</dt><dd>{revision.previous_is_active ? "Active" : "Paused"} → {revision.next_is_active ? "Active" : "Paused"}</dd></div></dl></article>)}</div> : <div className="review-empty"><strong>No profile changes yet.</strong><p>The first saved edit will appear here. Existing collection runs remain separate evidence of what was checked.</p></div>}
        </section>
      </section>
    </main>
  );
}
