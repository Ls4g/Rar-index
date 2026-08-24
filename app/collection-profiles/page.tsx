import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import CollectionRunForm from "@/components/CollectionRunForm";
import StaffNav from "@/components/StaffNav";
import { publicListingCoverage, SCOUT_PUBLIC_FRESHNESS_HOURS, SCOUT_PUBLIC_LISTING_TARGET, type ScoutCoverageLead } from "@/lib/scoutCoverage";

export const dynamic = "force-dynamic";

function currentScoutLiveCutoff() {
  return new Date(Date.now() - SCOUT_PUBLIC_FRESHNESS_HOURS * 60 * 60 * 1000).toISOString();
}

type CollectionProfile = {
  id: string;
  search_query: string;
  scope_notes: string;
  is_active: boolean;
  last_checked_at: string | null;
  last_checked_result_count: number | null;
  collection_interval_days: number;
  edition: { id: string; title: string | null; series: string | null; volume_number: string | number | null; language: string | null; isbn_13: string | null; publisher: string | null; format: string | null } | null;
  source: { name: string | null } | null;
};

type CollectionRun = {
  id: string;
  profile_id: string;
  checked_at: string;
  checked_by: string;
  candidate_count: number;
  notes: string;
};

type VerifiedSale = {
  edition_id: string;
  currency: string;
  grading_company: string | null;
  grade_label: string | null;
};

function formatDate(value: string | null) {
  if (!value) return "Not checked yet";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
}

function sourceSearchUrl(sourceName: string | null, query: string) {
  if (sourceName === "eBay Sold") {
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&LH_Sold=1&LH_Complete=1`;
  }
  return null;
}

function nextCheck(profile: CollectionProfile) {
  if (!profile.last_checked_at) return { label: "Ready to check now", isDue: true };
  const dueAt = new Date(profile.last_checked_at);
  dueAt.setDate(dueAt.getDate() + profile.collection_interval_days);
  const isDue = dueAt <= new Date();
  return { label: isDue ? `Due since ${formatDate(dueAt.toISOString())}` : `Next check ${formatDate(dueAt.toISOString())}`, isDue };
}

function cadenceLabel(days: number) {
  if (days === 7) return "Weekly";
  if (days === 14) return "Every two weeks";
  if (days === 30) return "Monthly";
  return `Every ${days} days`;
}

function chartEvidenceLabel(sales: VerifiedSale[]) {
  const groups = new Map<string, number>();
  for (const sale of sales) {
    const state = sale.grading_company || sale.grade_label ? "graded" : "raw";
    groups.set(state, (groups.get(state) ?? 0) + 1);
  }
  const best = [...groups.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return { label: "No verified comparable sales", detail: "A chart needs 3 verified sales in the same raw/graded group." };
  const [state] = best;
  if (best[1] >= 3) return { label: "Chart evidence ready", detail: `${best[1]} verified ${state} sales; RAR converts each at its sale-date rate.` };
  const missing = 3 - best[1];
  return { label: `${best[1]} of 3 comparable sales`, detail: `${state}; collect ${missing} more verified sale${missing === 1 ? "" : "s"} for a chart.` };
}

export default async function CollectionProfilesPage() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("marketplace_search_profiles")
    .select("id, search_query, scope_notes, is_active, last_checked_at, last_checked_result_count, collection_interval_days, edition:manga_editions(id, title, series, volume_number, language, isbn_13, publisher, format), source:sources(name)")
    .order("created_at", { ascending: false });
  const profiles = (data ?? []) as unknown as CollectionProfile[];
  const profileIds = profiles.map((profile) => profile.id);
  const liveCutoff = currentScoutLiveCutoff();
  const { data: liveLeadData } = profileIds.length
    ? await admin.from("scout_listing_leads")
      .select("profile_id,external_id,listing_title,item_end_at,last_seen_at,review_status")
      .in("profile_id", profileIds)
      .in("review_status", ["new", "watching"])
      .gte("last_seen_at", liveCutoff)
      .limit(5000)
    : { data: [] };
  const liveLeadsByProfile = new Map<string, ScoutCoverageLead[]>();
  for (const lead of (liveLeadData ?? []) as ScoutCoverageLead[]) {
    const rows = liveLeadsByProfile.get(lead.profile_id) ?? [];
    rows.push(lead);
    liveLeadsByProfile.set(lead.profile_id, rows);
  }
  const { data: runData } = profileIds.length
    ? await admin
      .from("marketplace_collection_runs")
      .select("id, profile_id, checked_at, checked_by, candidate_count, notes")
      .in("profile_id", profileIds)
      .order("checked_at", { ascending: false })
      .limit(50)
    : { data: [] };
  const runsByProfile = new Map<string, CollectionRun[]>();
  for (const run of (runData ?? []) as CollectionRun[]) {
    const runs = runsByProfile.get(run.profile_id) ?? [];
    runs.push(run);
    runsByProfile.set(run.profile_id, runs);
  }
  const editionIds = profiles.flatMap((profile) => profile.edition?.id ? [profile.edition.id] : []);
  const { data: saleData } = editionIds.length
    ? await admin
      .from("price_observations")
      .select("edition_id, currency, grading_company, grade_label")
      .in("edition_id", editionIds)
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
      .limit(1000)
    : { data: [] };
  const salesByEdition = new Map<string, VerifiedSale[]>();
  for (const sale of (saleData ?? []) as VerifiedSale[]) {
    const sales = salesByEdition.get(sale.edition_id) ?? [];
    sales.push(sale);
    salesByEdition.set(sale.edition_id, sales);
  }

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard →</Link>
        <Link className="header-note" href="/scout">RAR Scout →</Link>
        <Link className="header-note" href="/add-sale">Add one sale -&gt;</Link>
        <Link className="header-note" href="/data-readiness">Data readiness -&gt;</Link>
        <Link className="header-note" href="/price-import">Price import -&gt;</Link>
        <StaffNav current="/collection-profiles" />
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Repeatable collection specification</p>
          <h1>Marketplace search profiles</h1>
          <p>Each profile says exactly where RAR should look and what must be true before a completed listing can enter the import workflow.</p>
        </div>
        <div className="queue-total"><strong>{profiles.filter((profile) => profile.is_active).length}</strong><span>active profiles</span></div>
      </section>
      <section className="review-list-section">
        <div className="section-intro">
          <p className="eyebrow">Before collection</p>
          <h2>Search narrowly, then review</h2>
          <p className="section-copy">Open the exact completed-listings search when it is due, record what you found, then import only the candidates worth reviewing. This is an assisted workflow — it does not scrape or auto-import marketplace data.</p>
        </div>
        {profiles.length ? <div className="review-list">{profiles.map((profile) => {
          const searchUrl = sourceSearchUrl(profile.source?.name ?? null, profile.search_query);
          const runs = runsByProfile.get(profile.id) ?? [];
          const chartEvidence = chartEvidenceLabel(profile.edition ? salesByEdition.get(profile.edition.id) ?? [] : []);
          const liveCoverage = publicListingCoverage(profile, liveLeadsByProfile.get(profile.id) ?? []);
          return (
            <article className="review-card catalogue-card" key={profile.id}>
              <div className="review-card-topline"><span>{profile.source?.name ?? "Marketplace"}</span><time>{profile.is_active ? nextCheck(profile).label : "Paused"}</time></div>
              <div className="review-card-main"><div><h3>{profile.edition?.title ?? "Edition"}</h3><p className="review-condition">{[profile.edition?.language, profile.edition?.isbn_13 ? `ISBN ${profile.edition.isbn_13}` : null].filter(Boolean).join(" · ")}</p></div>{searchUrl ? <a className="review-source-link" href={searchUrl} target="_blank" rel="noreferrer">Open completed search ↗</a> : null}</div>
              <p><Link className="review-source-link" href={`/collection-profiles/${profile.id}`}>Open research workbench -&gt;</Link></p>
              <dl className="catalogue-details"><div><dt>Search query</dt><dd>{profile.search_query}</dd></div><div><dt>Cadence</dt><dd>{cadenceLabel(profile.collection_interval_days)}</dd></div><div><dt>Last checked</dt><dd>{formatDate(profile.last_checked_at)}{profile.last_checked_result_count !== null ? ` · ${profile.last_checked_result_count} results` : ""}</dd></div></dl>
              <div className="review-note"><span>Chart evidence</span><p><strong>{chartEvidence.label}</strong><br />{chartEvidence.detail}</p></div>
              <div className="review-note"><span>Scout coverage</span><p><strong>{liveCoverage} of {SCOUT_PUBLIC_LISTING_TARGET} usable live listings</strong><br />{liveCoverage >= SCOUT_PUBLIC_LISTING_TARGET ? "Covered — Scout treats this as maintenance work." : `Discovery priority — Scout still needs ${SCOUT_PUBLIC_LISTING_TARGET - liveCoverage}.`}</p></div>
              <div className="review-note"><span>Exact-edition rules</span><p>{profile.scope_notes}</p></div>
              <CollectionRunForm profileId={profile.id} />
              <div className="review-note"><span>Recent collection runs</span>{runs.length ? <ul>{runs.slice(0, 3).map((run) => <li key={run.id}>{formatDate(run.checked_at)} · {run.checked_by} · {run.candidate_count} candidates — {run.notes}</li>)}</ul> : <p>No run has been recorded yet.</p>}</div>
            </article>
          );
        })}</div> : <div className="review-empty"><strong>No search profiles yet.</strong><p>Create one only after its edition has enough verified identifiers to search safely.</p></div>}
      </section>
    </main>
  );
}
