import Link from "next/link";
import BrowseEditions, { type BrowseEdition } from "@/components/BrowseEditions";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function BrowsePage() {
  const { data, error } = await supabase
    .from("manga_editions")
    .select("id,title,series,volume_number,publisher,language,isbn_13,edition_statement,printing_number,variant_name,collectible_type")
    .eq("is_verified", true)
    .order("series", { ascending: true })
    .order("volume_number", { ascending: true })
    .limit(500);

  return (
    <main>
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/">Search</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
        </nav>
      </header>
      <section className="browse-hero">
        <div>
          <p className="eyebrow">RAR catalogue</p>
          <h1>Browse editions.</h1>
          <p>Find the exact record before you research prices or add it to your collection.</p>
        </div>
      </section>
      <section className="browse-content">
        {error ? <p className="status-message">The catalogue could not be loaded. Please try again shortly.</p> : <BrowseEditions editions={(data ?? []) as BrowseEdition[]} />}
      </section>
    </main>
  );
}
