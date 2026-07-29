import MangaSearch, { type Manga } from "@/components/MangaSearch";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

// Catalogue updates should appear without waiting for the next deployment.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ data, error }, { count }] = await Promise.all([
    supabase
    .from("manga_editions")
    .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name")
    .eq("is_verified", true)
    .order("created_at", { ascending: false })
    .limit(12),
    supabase.from("manga_editions").select("id", { count: "exact", head: true }).eq("is_verified", true),
  ]);

  const manga = (data ?? []) as Manga[];

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </a>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/browse">Browse editions</Link>
          <Link className="header-note" href="/portfolio">Portfolio -&gt;</Link>
        </nav>
      </header>

      <section id="top" className="hero">
        <div className="hero-grid" />
        <div className="hero-content">
          <p className="eyebrow">Manga collecting, made legible</p>
          <h1>
            Know what you own.
            <span>Find what matters.</span>
          </h1>
          <p className="hero-copy">
            RAR Index is building the reference point for manga editions,
            market history and collector knowledge.
          </p>
          <MangaSearch />
        </div>
      </section>

      <section className="index-section" aria-labelledby="new-additions-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The RAR Index</p>
            <h2 id="new-additions-heading">New additions</h2>
          </div>
          <span>{count ?? manga.length} verified edition{(count ?? manga.length) === 1 ? "" : "s"} indexed</span>
        </div>

        {error ? (
          <div className="status-message" role="alert">
            We could not load the manga index right now. Please try again shortly.
          </div>
        ) : manga.length > 0 ? (
          <div className="manga-grid">
            {manga.map((item, index) => (
              <Link className="manga-card" href={`/edition/${item.id}`} key={item.id}>
                <div className="card-cover" aria-hidden="true">
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <i>RAR</i>
                </div>
                <div className="card-body">
                  <p className="card-kicker">{[item.volume_number ? `Vol. ${item.volume_number}` : null, item.language].filter(Boolean).join(" · ") || "Manga edition"}</p>
                  <h3>{item.title || "Untitled manga"}</h3>
                  <dl>
                    <div>
                      <dt>Series</dt>
                      <dd>{item.series || "Not yet recorded"}</dd>
                    </div>
                    <div>
                      <dt>Edition</dt>
                      <dd>{item.variant_name || (item.printing_number ? `${item.printing_number}${item.printing_number === 1 ? "st" : "th"} printing` : item.edition_statement || "Edition details pending")}</dd>
                    </div>
                    <div>
                      <dt>Publisher</dt>
                      <dd>{item.publisher || "Not yet recorded"}</dd>
                    </div>
                  </dl>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="status-message">
            The index is ready for its first manga entries.
          </div>
        )}
      </section>

      <section className="principle-section">
        <p className="eyebrow">Built for collectors</p>
        <p>
          Database first. Price history next. Intelligence on top.
        </p>
      </section>

      <footer>
        <span>RAR Index</span>
        <span>Collectible intelligence, beginning with manga.</span>
      </footer>
    </main>
  );
}
