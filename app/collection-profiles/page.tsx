import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type CollectionProfile = {
  id: string;
  search_query: string;
  scope_notes: string;
  is_active: boolean;
  last_checked_at: string | null;
  last_checked_result_count: number | null;
  edition: { title: string | null; language: string | null; isbn_13: string | null } | null;
  source: { name: string | null } | null;
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

export default async function CollectionProfilesPage() {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("marketplace_search_profiles")
    .select("id, search_query, scope_notes, is_active, last_checked_at, last_checked_result_count, edition:manga_editions(title, language, isbn_13), source:sources(name)")
    .order("created_at", { ascending: false });
  const profiles = (data ?? []) as unknown as CollectionProfile[];

  return (
    <main className="review-page catalogue-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <Link className="header-note" href="/price-import">Price import -&gt;</Link>
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
          <p className="section-copy">Opening a search never imports a sale. Candidates still go through CSV preflight and the protected review queue.</p>
        </div>
        {profiles.length ? <div className="review-list">{profiles.map((profile) => {
          const searchUrl = sourceSearchUrl(profile.source?.name ?? null, profile.search_query);
          return (
            <article className="review-card catalogue-card" key={profile.id}>
              <div className="review-card-topline"><span>{profile.source?.name ?? "Marketplace"}</span><time>{profile.is_active ? "Active" : "Paused"}</time></div>
              <div className="review-card-main"><div><h3>{profile.edition?.title ?? "Edition"}</h3><p className="review-condition">{[profile.edition?.language, profile.edition?.isbn_13 ? `ISBN ${profile.edition.isbn_13}` : null].filter(Boolean).join(" · ")}</p></div>{searchUrl ? <a className="review-source-link" href={searchUrl} target="_blank" rel="noreferrer">Open completed search ↗</a> : null}</div>
              <dl className="catalogue-details"><div><dt>Search query</dt><dd>{profile.search_query}</dd></div><div><dt>Last checked</dt><dd>{formatDate(profile.last_checked_at)}{profile.last_checked_result_count !== null ? ` · ${profile.last_checked_result_count} results` : ""}</dd></div></dl>
              <div className="review-note"><span>Exact-edition rules</span><p>{profile.scope_notes}</p></div>
            </article>
          );
        })}</div> : <div className="review-empty"><strong>No search profiles yet.</strong><p>Create one only after its edition has enough verified identifiers to search safely.</p></div>}
      </section>
    </main>
  );
}
