import Link from "next/link";
import BrowseEditions, { type BrowseEdition } from "@/components/BrowseEditions";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const [{ data, error }, { data: verifiedSales }] = await Promise.all([
    supabase
      .from("manga_editions")
      .select("id,title,series,volume_number,publisher,language,isbn_13,edition_statement,printing_number,variant_name,collectible_type,cover_image_url,cover_verification_status,created_at,printing_of_edition_id")
      .eq("is_verified", true)
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("price_observations")
      .select("edition_id")
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
      .limit(1000),
  ]);
  const saleCounts = new Map<string, number>();
  for (const sale of verifiedSales ?? []) saleCounts.set(sale.edition_id, (saleCounts.get(sale.edition_id) ?? 0) + 1);
  const editions = (data ?? []).map((edition) => ({ ...edition, verified_sale_count: saleCounts.get(edition.id) ?? 0 })) as BrowseEdition[];

  return (
    <main className="public-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/identify">Identify a copy</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
          <Link className="header-note" href="/staff-login">Staff access</Link>
        </nav>
      </header>
      <section className="browse-hero">
        <div>
          <p className="eyebrow">RAR alpha catalogue</p>
          <h1>Browse the archive.</h1>
          <p>Every record here has a catalogue identity, ISBN, publisher, release date and linked source evidence.</p>
        </div>
        <div className="queue-total"><strong>{editions.length}</strong><span>catalogue-ready editions</span></div>
      </section>
      <section className="browse-content">
        {error ? <p className="status-message">The catalogue could not be loaded. Please try again shortly.</p> : <BrowseEditions editions={editions} />}
      </section>
    </main>
  );
}
