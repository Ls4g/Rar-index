import Link from "next/link";
import type { Metadata } from "next";
import ThemeToggle from "@/components/ThemeToggle";
import EditionCover from "@/components/EditionCover";
import { supabase } from "@/lib/supabase";
import { buildSeriesProgress, type CatalogueVolume } from "@/lib/seriesCompletion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track your manga collection — RAR Index",
  description: "Add the manga you own, see how far through each series you are, and publish a shelf other people can look at. Free, and private until you choose otherwise.",
};

type Row = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

// A second front door, not a second product.
//
// The audience research found r/MangaCollectors (1.93M) talks about shelving
// 311 times and grading once. "What's your manga actually worth?" is the
// right sentence for r/MangaRarity and the wrong one for them. Same data,
// same catalogue, different question on the door: track what you own, and
// find what you are missing.
export default async function CollectionPage() {
  const [{ data: catalogueData }, { count: totalCount }] = await Promise.all([
    supabase
      .from("manga_editions")
      .select("id,title,series,volume_number,language,cover_image_url,cover_verification_status")
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .limit(500),
    supabase
      .from("manga_editions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true)
      .eq("record_kind", "publication"),
  ]);

  const rows = (catalogueData ?? []) as Row[];
  const catalogue: CatalogueVolume[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    series: row.series,
    volumeNumber: row.volume_number,
    language: row.language,
    coverImageUrl: row.cover_image_url,
    coverStatus: row.cover_verification_status,
  }));
  // Owned by nobody here — this is the catalogue's own shape, used to show
  // honestly how much of a series RAR can currently follow.
  const series = buildSeriesProgress(catalogue, []);
  const multiVolume = series.filter((entry) => entry.tracked > 1);
  const withCovers = rows.filter((row) => row.cover_verification_status === "verified" && row.cover_image_url);
  const showcase = withCovers.slice(0, 12);

  return (
    <main className="public-page collection-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/browse">Browse manga</Link>
          <Link className="header-note" href="/identify">First-print check</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
          <ThemeToggle />
        </nav>
      </header>

      <section className="tool-hero collection-hero">
        <p className="eyebrow">Free collection tracking</p>
        <h1>Track what you own. Find what you&apos;re missing.</h1>
        <p>
          Add the manga on your shelf, and RAR shows how far through each series you are, what a copy is currently selling for if you want to know, and which volumes you still need. Private by default — publish a shelf only if you want to.
        </p>
        <div className="collection-hero-actions">
          <Link className="is-primary" href="/portfolio">Start your collection</Link>
          <Link href="/browse">Browse the catalogue</Link>
        </div>
      </section>

      <section className="tool-content collection-content">
        <div className="collection-steps">
          <article>
            <span className="lab">One</span>
            <h2>Add what you own</h2>
            <p>Search by title or ISBN and add the exact edition — the right publisher, the right language, the right printing. Free account, no card.</p>
          </article>
          <article>
            <span className="lab">Two</span>
            <h2>See how far through you are</h2>
            <p>Every series you have started shows which volumes you hold and which you do not, counted against what RAR has catalogued.</p>
          </article>
          <article>
            <span className="lab">Three</span>
            <h2>Show it, if you like</h2>
            <p>Publish a shelf at your own handle. It shows which editions you own and never what you paid, when you bought it, or your notes.</p>
          </article>
        </div>

        {/* The honest part. A collection tracker holding 74 books will not
            cover a shelf of 300, and pretending otherwise would burn exactly
            the audience this page is for. Saying it plainly also turns the
            limit into the contribution loop that fixes it. */}
        <section className="collection-scope">
          <h2>How much RAR can follow right now</h2>
          <div className="collection-scope-figures">
            <div><strong>{totalCount ?? rows.length}</strong><span>manga catalogued</span></div>
            <div><strong>{series.length}</strong><span>series represented</span></div>
            <div><strong>{multiVolume.length}</strong><span>with more than one volume</span></div>
            <div><strong>{withCovers.length}</strong><span>with a confirmed cover</span></div>
          </div>
          <p>
            That is a small catalogue and RAR is not going to pretend otherwise. Most series here are a single volume so far, which means completion counts are honest but short — RAR says &ldquo;3 of 4 tracked&rdquo;, never &ldquo;3 of 4&rdquo; as though the series ended there.
          </p>
          <p>
            If something you own is missing, <Link href="/request-edition">send it over</Link>. Every record is researched against a publisher or library source before it goes in, so the catalogue grows from what collectors actually hold rather than from a scrape.
          </p>
        </section>

        {showcase.length ? (
          <section className="collection-showcase">
            <h2>Already in the catalogue</h2>
            <div className="collection-showcase-grid">
              {showcase.map((row) => (
                <Link className="collection-showcase-item" href={`/edition/${row.id}`} key={row.id}>
                  <EditionCover
                    className="collection-showcase-cover"
                    imageStatus={row.cover_verification_status}
                    imageUrl={row.cover_image_url}
                    language={row.language}
                    series={row.series}
                    title={row.title}
                    volumeNumber={row.volume_number}
                  />
                  <span>{row.title ?? "Untitled"}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <div className="collection-cta">
          <h2>Start with one volume</h2>
          <p>You do not need to add a whole shelf to get something out of it. Add the book nearest to you and see what RAR knows about that exact edition.</p>
          <Link href="/portfolio">Create a free account →</Link>
        </div>
      </section>
    </main>
  );
}
