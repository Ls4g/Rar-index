import MangaSearch, { type Manga } from "@/components/MangaSearch";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { editionDescriptor, publisherDisplayName } from "@/lib/editionDisplay";

// Catalogue updates should appear without waiting for the next deployment.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ data, error }, { count }, { count: evidenceCount }, { count: firstPrintCount }, { data: allCatalogue }, { data: verifiedSales }] = await Promise.all([
    supabase
    .from("manga_editions")
    .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name, collectible_type, cover_image_url, cover_verification_status")
    .eq("is_verified", true)
    .not("isbn_13", "is", null)
    .not("publisher", "is", null)
    .not("release_date", "is", null)
    .order("created_at", { ascending: false })
    .limit(6),
    supabase
      .from("manga_editions")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true)
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null),
    supabase
      .from("alpha_catalogue_v1")
      .select("id", { count: "exact", head: true })
      .gt("verified_sale_count", 0),
    supabase
      .from("alpha_catalogue_v1")
      .select("id", { count: "exact", head: true })
      .eq("printing_number", 1),
    supabase
      .from("manga_editions")
      .select("id, title, series, volume_number, author, publisher, language, isbn_13, edition_statement, printing_number, variant_name, collectible_type, cover_image_url, cover_verification_status")
      .eq("is_verified", true)
      .not("isbn_13", "is", null)
      .not("publisher", "is", null)
      .not("release_date", "is", null)
      .limit(500),
    supabase
      .from("price_observations")
      .select("edition_id")
      .eq("sale_status", "confirmed")
      .eq("match_status", "verified_match")
      .limit(1000),
  ]);

  const manga = (data ?? []) as Manga[];
  const saleCounts = new Map<string, number>();
  for (const sale of verifiedSales ?? []) {
    saleCounts.set(sale.edition_id, (saleCounts.get(sale.edition_id) ?? 0) + 1);
  }
  const pricedEditions = ((allCatalogue ?? []) as Manga[])
    .filter((edition) => saleCounts.has(String(edition.id)))
    .sort((a, b) => (saleCounts.get(String(b.id)) ?? 0) - (saleCounts.get(String(a.id)) ?? 0))
    .slice(0, 6);

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="RAR Index home">
          <span className="brand-mark">R</span>
          <span>RAR</span>
          <em>Index</em>
        </a>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/identify">Identify a copy</Link>
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

      <section className="index-section market-evidence-section" aria-labelledby="market-evidence-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Start with evidence</p>
            <h2 id="market-evidence-heading">Editions with verified prices</h2>
          </div>
          <span>{evidenceCount ?? pricedEditions.length} edition{(evidenceCount ?? pricedEditions.length) === 1 ? "" : "s"} with confirmed sale evidence</span>
        </div>

        {pricedEditions.length > 0 ? (
          <>
            <p className="section-copy market-evidence-copy">Every sale links back to its original source. RAR only uses a sale in a valuation after its edition match has been verified.</p>
            <div className="manga-grid">
              {pricedEditions.map((item, index) => {
                const verifiedSaleCount = saleCounts.get(String(item.id)) ?? 0;
                return (
                  <Link className="manga-card priced-edition-card" href={`/edition/${item.id}`} key={item.id}>
                    <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="card-cover" priority={index < 3} />
                    <div className="card-body">
                      <p className="card-kicker">{verifiedSaleCount} verified sale{verifiedSaleCount === 1 ? "" : "s"} · {[item.volume_number ? `Vol. ${item.volume_number}` : null, item.language].filter(Boolean).join(" · ")}</p>
                      <h3>{item.title || "Untitled manga"}</h3>
                      <dl>
                        <div>
                          <dt>Series</dt>
                          <dd>{item.series || "Not yet recorded"}</dd>
                        </div>
                        <div>
                          <dt>Edition</dt>
                          <dd>{editionDescriptor(item)}</dd>
                        </div>
                      </dl>
                    </div>
                  </Link>
                );
              })}
            </div>
            <div className="index-section-action"><Link href="/browse?evidence=verified-sales">Browse editions with verified prices →</Link></div>
          </>
        ) : (
          <div className="status-message">RAR is reviewing its first sale sources. Catalogue entries never receive a price until the source and edition match are confirmed.</div>
        )}
      </section>

      <section className="index-section" aria-labelledby="new-additions-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">The RAR Index</p>
            <h2 id="new-additions-heading">Recently documented editions</h2>
          </div>
          <span>{count ?? manga.length} catalogue-ready edition{(count ?? manga.length) === 1 ? "" : "s"} indexed</span>
        </div>

        {error ? (
          <div className="status-message" role="alert">
            We could not load the manga index right now. Please try again shortly.
          </div>
        ) : manga.length > 0 ? (
          <>
            <div className="manga-grid">
              {manga.slice(0, 3).map((item, index) => (
                <Link className="manga-card" href={`/edition/${item.id}`} key={item.id}>
                  <EditionCover title={item.title} series={item.series} volumeNumber={item.volume_number} language={item.language} imageUrl={item.cover_image_url} imageStatus={item.cover_verification_status} className="card-cover" priority={index < 3} />
                  <div className="card-body">
                    <p className="card-kicker">{[item.collectible_type?.replaceAll("_", " "), item.volume_number ? `Vol. ${item.volume_number}` : null, item.language].filter(Boolean).join(" · ") || "Manga edition"}</p>
                    <h3>{item.title || "Untitled manga"}</h3>
                    <dl>
                      <div>
                        <dt>Series</dt>
                        <dd>{item.series || "Not yet recorded"}</dd>
                      </div>
                      <div>
                        <dt>Edition</dt>
                        <dd>{editionDescriptor(item)}</dd>
                      </div>
                      <div>
                        <dt>Publisher</dt>
                        <dd>{publisherDisplayName(item.publisher)}</dd>
                      </div>
                    </dl>
                  </div>
                </Link>
              ))}
            </div>
            <div className="index-section-action"><Link href="/browse">Browse all catalogue-ready editions →</Link></div>
          </>
        ) : (
          <div className="status-message">
            The index is ready for its first manga entries.
          </div>
        )}
      </section>

      <section className="index-explore" aria-labelledby="explore-index-heading">
        <div className="section-intro">
          <p className="eyebrow">Start with what you need</p>
          <h2 id="explore-index-heading">Explore the index</h2>
          <p className="section-copy">Choose a useful starting point, then follow the original evidence behind every record.</p>
        </div>
        <div className="index-explore-grid">
          <Link href="/browse"><span>Catalogue</span><strong>Browse all {count ?? manga.length} editions</strong><small>Search by title, publisher, language or ISBN.</small></Link>
          <Link href="/browse?evidence=verified-sales"><span>Market evidence</span><strong>{evidenceCount ?? 0} editions with verified sales</strong><small>See only editions with confirmed matching sale evidence.</small></Link>
          <Link href="/browse?printing=first"><span>Printing research</span><strong>{firstPrintCount ?? 0} first-print records</strong><small>Check the record and its linked source before relying on a printing claim.</small></Link>
          <a href="#new-additions-heading"><span>New research</span><strong>Recently documented editions</strong><small>See the newest records added to the growing catalogue.</small></a>
        </div>
      </section>

      <section className="collector-pathways" aria-labelledby="collector-pathways-heading">
        <div className="section-intro">
          <p className="eyebrow">Start with the question</p>
          <h2 id="collector-pathways-heading">Research with RAR</h2>
          <p className="section-copy">A collector should be able to identify an item, understand the evidence, then decide what a recorded sale actually means.</p>
        </div>
        <div className="collector-pathway-list">
          <Link href="/identify">
            <span>01</span>
            <div><strong>Identify a copy</strong><p>Use the copyright page and identifiers before calling something a first print.</p></div>
            <b>→</b>
          </Link>
          <Link href="/browse">
            <span>02</span>
            <div><strong>Browse verified editions</strong><p>Search the growing catalogue by title, language, publisher, ISBN, or collectible type.</p></div>
            <b>→</b>
          </Link>
          <Link href="/request-edition">
            <span>03</span>
            <div><strong>Request a missing edition</strong><p>Send RAR a sourced lead for review. A request never becomes a record automatically.</p></div>
            <b>→</b>
          </Link>
        </div>
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
