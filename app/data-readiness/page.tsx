import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import StaffNav from "@/components/StaffNav";

export const dynamic = "force-dynamic";

type Readiness = {
  edition_id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  isbn_13: string | null;
  evidence_count: number;
  active_profile_count: number;
  collection_run_count: number;
  verified_sale_count: number;
  review_sale_count: number;
  readiness_status: "needs_catalogue_review" | "catalogue_incomplete" | "evidence_needed" | "profile_needed" | "search_ready" | "under_review" | "valuation_ready" | "collecting";
};
type ProfileLink = { id: string; edition_id: string };

const labels: Record<Readiness["readiness_status"], string> = {
  needs_catalogue_review: "Needs catalogue review",
  catalogue_incomplete: "Catalogue incomplete",
  evidence_needed: "Evidence needed",
  profile_needed: "Profile needed",
  search_ready: "Search ready",
  under_review: "Under review",
  valuation_ready: "Valuation ready",
  collecting: "Collecting",
};

const orderedStatuses: Readiness["readiness_status"][] = ["needs_catalogue_review", "catalogue_incomplete", "evidence_needed", "profile_needed", "search_ready", "collecting", "under_review", "valuation_ready"];

function nextAction(row: Readiness, profileId?: string) {
  if (row.readiness_status === "search_ready" || row.readiness_status === "collecting") {
    return profileId ? { href: `/collection-profiles/${profileId}`, label: "Open workbench" } : { href: `/collection-profiles/new?editionId=${row.edition_id}`, label: "Create profile" };
  }
  if (row.readiness_status === "under_review") return { href: "/review", label: "Review sales" };
  if (row.readiness_status === "profile_needed") return { href: `/collection-profiles/new?editionId=${row.edition_id}`, label: "Create profile" };
  return { href: "/catalogue-review", label: "Review catalogue" };
}

export default async function DataReadinessPage() {
  const admin = getSupabaseAdmin();
  const [{ data }, { data: profileData }] = await Promise.all([
    admin
      .from("edition_readiness")
      .select("edition_id,title,series,volume_number,language,isbn_13,evidence_count,active_profile_count,collection_run_count,verified_sale_count,review_sale_count,readiness_status")
      .order("series", { ascending: true })
      .order("title", { ascending: true }),
    admin.from("marketplace_search_profiles").select("id,edition_id").eq("is_active", true),
  ]);
  const rows = (data ?? []) as unknown as Readiness[];
  const profileByEdition = new Map<string, string>();
  for (const profile of (profileData ?? []) as ProfileLink[]) if (!profileByEdition.has(profile.edition_id)) profileByEdition.set(profile.edition_id, profile.id);
  const counts = rows.reduce<Record<string, number>>((total, row) => {
    total[row.readiness_status] = (total[row.readiness_status] ?? 0) + 1;
    return total;
  }, {});
  const actionRows = rows.filter((row) => !["valuation_ready", "collecting"].includes(row.readiness_status));
  const pricedRows = rows
    .filter((row) => row.verified_sale_count > 0)
    .sort((left, right) => left.verified_sale_count - right.verified_sale_count || left.review_sale_count - right.review_sale_count)
    .slice(0, 12);

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/coverage-dashboard">Coverage dashboard -&gt;</Link>
        <Link className="header-note" href="/cover-review">Cover review -&gt;</Link>
        <Link className="header-note" href="/add-sale">Add one sale -&gt;</Link>
        <Link className="header-note" href="/review">Review queue -&gt;</Link>
        <Link className="header-note" href="/collection-profiles">Collection profiles -&gt;</Link>
        <StaffNav current="/data-readiness" />
      </header>
      <section className="review-hero catalogue-hero">
        <div>
          <p className="eyebrow">Internal data operations</p>
          <h1>Edition readiness</h1>
          <p>Every status is calculated from actual catalogue fields, source evidence, profiles, collection runs, and reviewed sales. It is a work queue, not a manual label.</p>
        </div>
        <div className="queue-total"><strong>{rows.length}</strong><span>catalogue records tracked</span></div>
      </section>
      <section className="catalogue-content">
        <section className="review-list-section workbench-section collection-priority-section">
          <div className="section-intro"><p className="eyebrow">Evidence priorities</p><h2>Where another verified sale matters most</h2><p className="section-copy">This keeps manual work focused on editions that already have evidence, but are still too thin to become useful collector references.</p></div>
          {pricedRows.length ? <div className="collection-priority-grid">{pricedRows.map((row) => <Link href={`/edition/${row.edition_id}`} key={row.edition_id}><span>{row.verified_sale_count >= 3 ? "Strengthen the sample" : `${Math.max(0, 3 - row.verified_sale_count)} more for a first chart`}</span><strong>{row.title ?? "Untitled edition"}</strong><small>{[row.series, row.volume_number ? `Vol. ${row.volume_number}` : null, row.language].filter(Boolean).join(" | ")}</small><b>{row.verified_sale_count} verified · {row.review_sale_count} in review</b></Link>)}</div> : <div className="review-empty"><strong>No priced editions yet.</strong><p>Once one exact edition has a verified sale, it will appear here as a collection target.</p></div>}
        </section>
        <div className="catalogue-rules readiness-summary">
          {orderedStatuses.filter((status) => counts[status]).map((status) => <div key={status}><span>{counts[status]}</span><strong>{labels[status]}</strong><p>{status === "search_ready" ? "Can be checked with its exact saved marketplace profile." : status === "valuation_ready" ? "Has at least one verified sale." : "Requires the next controlled workflow step."}</p></div>)}
        </div>
        <section className="review-list-section workbench-section">
          <div className="section-intro"><p className="eyebrow">Next actions</p><h2>Work only on what is blocked</h2><p className="section-copy">This list excludes records already collecting or valuation-ready. The goal is to remove a real data constraint, not add activity for its own sake.</p></div>
          <div className="readiness-table-wrap"><table><thead><tr><th>Edition</th><th>Status</th><th>Evidence</th><th>Profile</th><th>Collection</th><th>Sales</th><th>Do next</th></tr></thead><tbody>{actionRows.map((row) => { const action = nextAction(row, profileByEdition.get(row.edition_id)); return <tr key={row.edition_id}><td><Link href={`/edition/${row.edition_id}`}><strong>{row.title ?? "Untitled edition"}</strong></Link><small>{[row.series, row.volume_number ? `Vol. ${row.volume_number}` : null, row.language, row.isbn_13 ? `ISBN ${row.isbn_13}` : null].filter(Boolean).join(" | ")}</small></td><td><span className={`import-status ${row.readiness_status}`}>{labels[row.readiness_status]}</span></td><td>{row.evidence_count}</td><td>{row.active_profile_count}</td><td>{row.collection_run_count}</td><td>{row.verified_sale_count} verified / {row.review_sale_count} review</td><td><Link className="staff-action-link" href={action.href}>{action.label} -&gt;</Link></td></tr>; })}</tbody></table></div>
        </section>
      </section>
    </main>
  );
}
