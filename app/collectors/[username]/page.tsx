import Link from "next/link";
import type { Metadata } from "next";
import EditionCover from "@/components/EditionCover";
import ThemeToggle from "@/components/ThemeToggle";
import { supabase } from "@/lib/supabase";
import { editionDescriptor, publisherDisplayName } from "@/lib/editionDisplay";
import { normalizeUsername } from "@/lib/username";
import { buildSeriesProgress, type CatalogueVolume } from "@/lib/seriesCompletion";

export const dynamic = "force-dynamic";

type ShelfEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

// A published shelf carries no money at all. public_shelf_editions exposes a
// handle and an edition id and nothing else -- no purchase price, date, note
// or quantity ever reaches this page, because those columns are not in the
// view. Anyone arriving here sees what someone owns, never what they paid.
async function loadShelf(username: string) {
  const key = normalizeUsername(username);
  const { data: rows } = await supabase
    .from("public_shelf_editions")
    .select("username,edition_id")
    .eq("username_key", key);

  const shelf = (rows ?? []) as Array<{ username: string; edition_id: string }>;
  if (!shelf.length) return null;

  const editionIds = [...new Set(shelf.map((row) => row.edition_id))];
  const { data: editionData } = await supabase
    .from("manga_editions")
    .select("id,title,series,volume_number,language,publisher,edition_statement,printing_number,variant_name,cover_image_url,cover_verification_status")
    .in("id", editionIds);

  return { displayName: shelf[0].username, editions: (editionData ?? []) as ShelfEdition[] };
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }): Promise<Metadata> {
  const { username } = await params;
  const shelf = await loadShelf(username);
  if (!shelf) return { title: "Collector shelf — RAR Index" };
  return {
    title: `${shelf.displayName}'s shelf — RAR Index`,
    description: `${shelf.editions.length} manga on ${shelf.displayName}'s public shelf, catalogued by exact edition on RAR Index.`,
  };
}

export default async function CollectorShelfPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const shelf = await loadShelf(username);

  return (
    <main className="public-page collector-shelf-page">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="RAR Index home"><span className="brand-mark">R</span><span>RAR</span><em>Index</em></Link>
        <nav className="header-links" aria-label="Main navigation">
          <Link className="header-note" href="/browse">Browse manga</Link>
          <Link className="header-note" href="/portfolio">Start your own shelf -&gt;</Link>
          <ThemeToggle />
        </nav>
      </header>

      {!shelf ? (
        <section className="tool-hero">
          <p className="eyebrow">Collector shelf</p>
          <h1>No public shelf here.</h1>
          <p>Either nobody has claimed <strong>@{username}</strong>, or they have not made their shelf public. Shelves are private until a collector chooses to publish one.</p>
        </section>
      ) : (
        <ShelfBody displayName={shelf.displayName} editions={shelf.editions} />
      )}
    </main>
  );
}

function ShelfBody({ displayName, editions }: { displayName: string; editions: ShelfEdition[] }) {
  const catalogue: CatalogueVolume[] = editions.map((edition) => ({
    id: edition.id,
    title: edition.title,
    series: edition.series,
    volumeNumber: edition.volume_number,
    language: edition.language,
    coverImageUrl: edition.cover_image_url,
    coverStatus: edition.cover_verification_status,
  }));
  // Every edition here is owned, so this counts series represented on the
  // shelf rather than progress towards anything.
  const bySeries = buildSeriesProgress(catalogue, editions.map((edition) => edition.id));
  const withCovers = editions.filter((edition) => edition.cover_verification_status === "verified" && edition.cover_image_url).length;

  return (
    <>
      <section className="tool-hero collector-shelf-hero">
        <p className="eyebrow">Collector shelf</p>
        <h1>@{displayName}</h1>
        <p>{editions.length} manga · {bySeries.length} series</p>
      </section>

      <section className="tool-content collector-shelf-content">
        <div className="collector-shelf-grid">
          {editions.map((edition) => (
            <Link className="collector-shelf-card" href={`/edition/${edition.id}`} key={edition.id}>
              <EditionCover
                className="collector-shelf-card-cover"
                imageStatus={edition.cover_verification_status}
                imageUrl={edition.cover_image_url}
                language={edition.language}
                series={edition.series}
                title={edition.title}
                volumeNumber={edition.volume_number}
              />
              <span className="collector-shelf-card-title">{edition.title ?? "Untitled"}</span>
              <span className="collector-shelf-card-meta">
                {[edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, publisherDisplayName(edition.publisher)].filter(Boolean).join(" · ")}
              </span>
              <span className="collector-shelf-card-meta">{editionDescriptor(edition)}</span>
            </Link>
          ))}
        </div>

        <p className="collector-shelf-footnote">
          A public shelf shows which exact editions someone owns. It never shows what they paid, when they bought it, or any note they wrote — those stay private to the collector.
          {withCovers < editions.length ? ` ${editions.length - withCovers} of these are still waiting on a confirmed cover.` : ""}
        </p>

        <div className="collector-shelf-cta">
          <Link href="/portfolio">Start your own shelf →</Link>
        </div>
      </section>
    </>
  );
}
