import Link from "next/link";
import type { Metadata } from "next";
import EditionCover from "@/components/EditionCover";
import PublicHeader from "@/components/PublicHeader";
import { supabase } from "@/lib/supabase";
import { collectorMarketGuide, type CollectorMarketSale } from "@/lib/collectorMarketGuide";
import { normalizeUsername } from "@/lib/username";
import { volumeSortValue } from "@/lib/seriesCompletion";
import DemoBookShelf, { type DemoBookEdition, type DemoSeriesBook } from "@/app/design-concept/collector/DemoBookShelf";
import "@/app/design-concept/style.css";
import "@/app/design-concept/collector/style.css";
import "@/app/design-concept/collector/physical-book.css";

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

  const editions = (editionData ?? []) as ShelfEdition[];
  const seriesNames = [...new Set(editions.map((edition) => edition.series).filter((value): value is string => Boolean(value)))];
  const catalogueData: Array<{ series: string | null; language: string | null; volume_number: string | null }> = [];
  for (let offset = 0; seriesNames.length; offset += 1000) {
    const { data, error } = await supabase.from("manga_editions")
      .select("series,language,volume_number").eq("is_verified", true).eq("record_kind", "publication")
      .in("series", seriesNames).order("id").range(offset, offset + 999);
    if (error) break;
    catalogueData.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const { data: printRunsData } = editionIds.length ? await supabase.from("manga_editions")
    .select("id,printing_of_edition_id").in("printing_of_edition_id", editionIds) : { data: [] };
  const printRuns = (printRunsData ?? []) as Array<{ id: string; printing_of_edition_id: string }>;
  const familyIds = [...editionIds, ...printRuns.map((run) => run.id)];
  const sales: Array<CollectorMarketSale & { edition_id: string }> = [];
  for (let offset = 0; familyIds.length; offset += 1000) {
    const { data, error } = await supabase.from("price_observations")
      .select("edition_id,sale_status,match_status,source_listing_url,sold_date,sale_price,currency,grading_company,grade_label,grading_reviewed_at,listing_title,print_classification,printing_proof_url,known_printing_number")
      .in("edition_id", familyIds).eq("sale_status", "confirmed").eq("match_status", "verified_match")
      .not("source_listing_url", "is", null).order("sold_date").range(offset, offset + 999);
    if (error) break;
    sales.push(...(data ?? []) as Array<CollectorMarketSale & { edition_id: string }>);
    if (!data || data.length < 1000) break;
  }
  const childIds = new Map<string, string[]>();
  for (const run of printRuns) childIds.set(run.printing_of_edition_id, [...(childIds.get(run.printing_of_edition_id) ?? []), run.id]);
  const ownedBySeries = new Map<string, ShelfEdition[]>();
  for (const edition of editions) {
    const key = `${edition.series || edition.title || edition.id}::${edition.language || ""}`;
    ownedBySeries.set(key, [...(ownedBySeries.get(key) ?? []), edition]);
  }
  const books: DemoSeriesBook[] = [...ownedBySeries].map(([key, owned]) => {
    const sorted = [...owned].sort((a, b) => (volumeSortValue(a.volume_number) ?? 9999) - (volumeSortValue(b.volume_number) ?? 9999) || a.id.localeCompare(b.id));
    const representative = sorted.find((edition) => edition.cover_verification_status === "verified" && edition.cover_image_url) ?? sorted[0];
    const toBookEdition = (edition: ShelfEdition): DemoBookEdition => {
      const ids = new Set([edition.id, ...(childIds.get(edition.id) ?? [])]);
      return {
        id: edition.id, title: edition.title, series: edition.series, volumeNumber: edition.volume_number,
        language: edition.language, publisher: edition.publisher, coverUrl: edition.cover_image_url,
        coverStatus: edition.cover_verification_status,
        marketGuide: collectorMarketGuide(sales.filter((sale) => ids.has(sale.edition_id))),
      };
    };
    const catalogued = new Set(catalogueData.filter((row) => row.series === representative.series && row.language === representative.language)
      .map((row) => row.volume_number?.trim()).filter(Boolean));
    const ownedVolumes = new Set(sorted.map((edition) => edition.volume_number?.trim() || edition.id));
    return {
      key, name: representative.series || representative.title || "Manga series", language: representative.language,
      representative: toBookEdition(representative), owned: sorted.map(toBookEdition),
      ownedVolumeCount: ownedVolumes.size,
      cataloguedVolumes: Math.max(ownedVolumes.size, catalogued.size),
    };
  }).sort((a, b) => b.owned.length - a.owned.length || a.name.localeCompare(b.name));

  return { displayName: shelf[0].username, editions, books };
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

  return !shelf ? (
    <main className="public-page collector-shelf-page"><PublicHeader />
      <section className="tool-hero">
        <p className="eyebrow">Collector shelf</p>
        <h1>No public shelf here.</h1>
        <p>Either nobody has claimed <strong>@{username}</strong>, or they have not made their shelf public. Shelves are private until a collector chooses to publish one.</p>
      </section>
    </main>
  ) : (
    <main className="rar-concept rar-demo-profile rar-public-collector">
      <header className="rar-concept-header">
        <Link className="rar-concept-logo" href="/" aria-label="RAR Index home"><b>R</b><span>RAR</span><small>INDEX</small></Link>
        <nav aria-label="Main navigation"><Link href="/browse">Discover</Link><Link href="/collection">Collections</Link><Link href="/buy-manga">Buy manga</Link><Link className="rar-public-header-secondary" href="/staff-login">Staff</Link></nav>
        <Link className="rar-concept-header-cta" href="/portfolio">Your shelf <span>↗</span></Link>
      </header>
      <ShelfBody displayName={shelf.displayName} editions={shelf.editions} books={shelf.books} />
    </main>
  );
}

function ShelfBody({ displayName, editions, books }: { displayName: string; editions: ShelfEdition[]; books: DemoSeriesBook[] }) {
  const withCovers = editions.filter((edition) => edition.cover_verification_status === "verified" && edition.cover_image_url).length;
  const languages = new Set(editions.map((edition) => edition.language).filter(Boolean));
  const spotlight = books.slice(0, 3);

  return (
    <>
      <section className="rar-demo-hero" aria-labelledby="collector-title">
        <div className="rar-concept-container rar-demo-hero-inner">
          <div className="rar-demo-identity">
            <div className="rar-demo-identity-top"><span className="rar-demo-avatar" aria-hidden="true">{displayName[0]?.toUpperCase()}</span><span className="rar-demo-identity-type">PUBLIC COLLECTOR SHELF</span></div>
            <p className="rar-demo-handle">@{displayName}</p>
            <h1 id="collector-title">{displayName}<span>.</span></h1>
            <p className="rar-demo-bio">A manga shelf made to be explored. Open a cover to see the volumes this collector chose to share.</p>
            <div className="rar-demo-stats" aria-label="Public shelf summary">
              <div><strong>{editions.length}</strong><span>SHARED EDITIONS</span></div>
              <div><strong>{books.length}</strong><span>SERIES</span></div>
              <div><strong>{languages.size}</strong><span>LANGUAGES</span></div>
            </div>
            <p className="rar-demo-disclaimer">Only publicly shared editions appear here. Purchase prices, dates and private notes are never shown.</p>
          </div>
          <div className="rar-demo-hero-gallery" aria-hidden="true">
            {spotlight.map((book, index) => <div className={`rar-demo-hero-book is-${index + 1}`} key={book.key}><EditionCover title={book.representative.title} series={book.name} volumeNumber={book.representative.volumeNumber} language={book.language} imageUrl={book.representative.coverUrl} imageStatus={book.representative.coverStatus} priority /></div>)}
            <span className="rar-demo-hero-gallery-label">RAR / COLLECTOR SHELVES</span>
          </div>
        </div>
      </section>
      <DemoBookShelf books={books} isDemo={false} ownerName={displayName} />
      <section className="rar-demo-join"><div className="rar-concept-container"><div><p className="rar-concept-kicker">BUILD YOUR OWN SHELF</p><h2>Your manga. Your shelf.</h2><p>{withCovers < editions.length ? `${editions.length - withCovers} shared editions are still waiting on a confirmed cover. ` : ""}Choose what to share; what you paid and your private notes stay yours.</p></div><Link className="rar-concept-button is-primary" href="/portfolio">Build your shelf <span>↗</span></Link></div></section>
    </>
  );
}
