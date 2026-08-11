import Link from "next/link";
import BrowseEditions, { type BrowseEdition } from "@/components/BrowseEditions";
import { supabase } from "@/lib/supabase";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  // Browse lists publications only -- a print-run record (e.g. a proven
  // first printing) is never a separate destination; its evidence already
  // rolls up into its publication via publication_print_readiness, and
  // visiting its own /edition/{id} just redirects here anyway.
  const [{ data, error }, { data: readinessRows }] = await Promise.all([
    supabase
      .from("manga_editions")
      .select("id,title,series,volume_number,publisher,language,isbn_13,edition_statement,collectible_type,cover_image_url,cover_verification_status,created_at")
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("publication_print_readiness")
      .select("publication_id,first_print_proven_sale_count,known_later_print_sale_count,printing_not_identified_sale_count,total_verified_sale_count,has_first_print_evidence"),
  ]);
  const readinessById = new Map((readinessRows ?? []).map((row) => [row.publication_id, row]));
  const editions = (data ?? []).map((edition) => {
    const readiness = readinessById.get(edition.id);
    return {
      ...edition,
      verified_sale_count: readiness?.total_verified_sale_count ?? 0,
      firstPrintProvenCount: readiness?.first_print_proven_sale_count ?? 0,
      printingNotIdentifiedCount: readiness?.printing_not_identified_sale_count ?? 0,
      hasFirstPrintEvidence: readiness?.has_first_print_evidence ?? false,
    };
  }) as BrowseEdition[];

  return (
    <main className="public-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/identify">First-print check</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
          <Link className="header-note" href="/staff-login">Staff access</Link>
          <ThemeToggle />
        </nav>
      </header>
      <section className="browse-hero">
        <div>
          <p className="eyebrow">The catalogue</p>
          <h1>Browse every manga we track.</h1>
          <p>Each one is a specific edition — a known ISBN, publisher and release date, not just a title. Open one to see what real copies sold for and which printings we have proof of.</p>
        </div>
        <div className="queue-total"><strong>{editions.length}</strong><span>manga in the catalogue</span></div>
      </section>
      <section className="browse-content">
        {error ? <p className="status-message">The catalogue could not be loaded. Please try again shortly.</p> : <BrowseEditions editions={editions} />}
      </section>
    </main>
  );
}
