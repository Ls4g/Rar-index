import type { Metadata } from "next";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { collectorMarketGuide, type CollectorMarketSale } from "@/lib/collectorMarketGuide";
import { volumeSortValue } from "@/lib/seriesCompletion";
import { supabase } from "@/lib/supabase";
import DemoBookShelf, { type DemoBookEdition, type DemoSeriesBook } from "./DemoBookShelf";
import "../style.css";
import "./style.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Demo collector profile — RAR design concept",
  robots: { index: false, follow: false },
};

type DemoEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  publisher: string | null;
  cover_image_url: string | null;
  cover_verification_status: string | null;
};

const seriesOrder = [
  "One Piece", "Dragon Ball", "Naruto", "Hunter x Hunter", "Berserk", "Slam Dunk",
  "Bleach", "Jujutsu Kaisen", "Chainsaw Man", "Attack on Titan", "Fullmetal Alchemist",
  "Demon Slayer", "Black Clover", "Kagurabachi", "Frieren",
];

function cover(edition: DemoEdition, priority = false) {
  return <EditionCover
    title={edition.title}
    series={edition.series}
    volumeNumber={edition.volume_number}
    language={edition.language}
    imageUrl={edition.cover_image_url}
    imageStatus={edition.cover_verification_status}
    priority={priority}
  />;
}

function chooseDemoRepresentatives(catalogue: DemoEdition[]) {
  const chosen: DemoEdition[] = [];
  const usedSeries = new Set<string>();
  const byPreference = [...catalogue].sort((a, b) => {
    const aRank = seriesOrder.findIndex((name) => name.toLowerCase() === a.series?.toLowerCase());
    const bRank = seriesOrder.findIndex((name) => name.toLowerCase() === b.series?.toLowerCase());
    const rankDifference = (aRank < 0 ? 999 : aRank) - (bRank < 0 ? 999 : bRank);
    if (rankDifference) return rankDifference;
    const volumeDifference = Number(a.volume_number || 999) - Number(b.volume_number || 999);
    if (Number.isFinite(volumeDifference) && volumeDifference) return volumeDifference;
    return a.id.localeCompare(b.id);
  });

  for (const edition of byPreference) {
    const series = (edition.series || edition.title || edition.id).toLowerCase();
    if (usedSeries.has(series)) continue;
    usedSeries.add(series);
    chosen.push(edition);
    if (chosen.length === 12) break;
  }
  return chosen;
}

function volumeKey(edition: DemoEdition) {
  return String(volumeSortValue(edition.volume_number) ?? edition.volume_number?.trim().toLowerCase() ?? edition.id);
}

function sameSeriesAndLanguage(left: DemoEdition, right: DemoEdition) {
  return (left.series || left.title || "").toLowerCase() === (right.series || right.title || "").toLowerCase()
    && left.language?.toLowerCase() === right.language?.toLowerCase();
}

function orderedVolumes(editions: DemoEdition[]) {
  return [...editions].sort((a, b) => (volumeSortValue(a.volume_number) ?? 9999) - (volumeSortValue(b.volume_number) ?? 9999)
    || a.id.localeCompare(b.id));
}

function publisherAffinity(edition: DemoEdition, representative: DemoEdition) {
  const normalize = (value: string | null) => (value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const publisher = normalize(edition.publisher);
  const preferred = normalize(representative.publisher);
  if (publisher && publisher === preferred) return 0;
  if (publisher && preferred && (publisher.startsWith(preferred) || preferred.startsWith(publisher))) return 1;
  return 2;
}

async function loadSeriesCatalogue(seriesNames: string[]): Promise<DemoEdition[]> {
  if (!seriesNames.length) return [];
  const catalogue: DemoEdition[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("manga_editions")
      .select("id,title,series,volume_number,language,publisher,cover_image_url,cover_verification_status")
      .eq("is_verified", true).eq("record_kind", "publication")
      .in("series", seriesNames).order("id").range(offset, offset + 999);
    if (error) throw new Error("Could not load complete catalogue coverage for the demo profile.");
    catalogue.push(...(data ?? []) as DemoEdition[]);
    if (!data || data.length < 1000) return catalogue;
  }
}

async function loadConfirmedSales(editionIds: string[]): Promise<Array<CollectorMarketSale & { edition_id: string }>> {
  if (!editionIds.length) return [];
  const sales: Array<CollectorMarketSale & { edition_id: string }> = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("price_observations")
      .select("id,edition_id,sale_status,match_status,source_listing_url,sold_date,sale_price,currency,grading_company,grade_label,grading_reviewed_at,listing_title,print_classification,printing_proof_url,known_printing_number")
      .in("edition_id", editionIds).eq("sale_status", "confirmed").eq("match_status", "verified_match")
      .not("source_listing_url", "is", null).order("id").range(offset, offset + 999);
    if (error) throw new Error("Could not load complete verified-sale coverage for the demo profile.");
    sales.push(...(data ?? []) as Array<CollectorMarketSale & { edition_id: string }>);
    if (!data || data.length < 1000) return sales;
  }
}

export default async function DemoCollectorProfilePage() {
  const { data } = await supabase.from("manga_editions")
    .select("id,title,series,volume_number,language,publisher,cover_image_url,cover_verification_status")
    .eq("is_verified", true).eq("record_kind", "publication")
    .eq("cover_verification_status", "verified").not("cover_image_url", "is", null)
    .limit(500);
  const representatives = chooseDemoRepresentatives((data ?? []) as DemoEdition[]);
  const seriesNames = [...new Set(representatives.map((edition) => edition.series).filter((value): value is string => Boolean(value)))];
  const catalogue = await loadSeriesCatalogue(seriesNames);
  const sampleBySeries = representatives.map((representative, index) => {
    const sameSeries = orderedVolumes([representative, ...catalogue.filter((edition) => edition.id !== representative.id && sameSeriesAndLanguage(edition, representative))]);
    const eligible = sameSeries.filter((edition) => edition.cover_verification_status === "verified" && edition.cover_image_url)
      .sort((a, b) => (volumeSortValue(a.volume_number) ?? 9999) - (volumeSortValue(b.volume_number) ?? 9999)
        || publisherAffinity(a, representative) - publisherAffinity(b, representative) || a.id.localeCompare(b.id));
    const owned = [representative];
    const selectedVolumes = new Set([volumeKey(representative)]);
    for (const edition of eligible) {
      if (owned.length >= (index < 3 ? 4 : 1)) break;
      const volume = volumeKey(edition);
      if (selectedVolumes.has(volume)) continue;
      owned.push(edition);
      selectedVolumes.add(volume);
    }
    return { representative, owned: orderedVolumes(owned), cataloguedVolumes: new Set(sameSeries.map(volumeKey)).size };
  });
  const selectedEditions = sampleBySeries.flatMap((series) => series.owned);
  const selectedIds = selectedEditions.map((edition) => edition.id);
  const { data: childrenData } = selectedIds.length ? await supabase.from("manga_editions")
    .select("id,printing_of_edition_id").in("printing_of_edition_id", selectedIds) : { data: [] };
  const children = (childrenData ?? []) as Array<{ id: string; printing_of_edition_id: string | null }>;
  const familyIds = [...new Set([...selectedIds, ...children.map((child) => child.id)])];
  const sales = await loadConfirmedSales(familyIds);
  const childIdsByPublication = new Map<string, string[]>();
  for (const child of children) if (child.printing_of_edition_id) childIdsByPublication.set(child.printing_of_edition_id,
    [...(childIdsByPublication.get(child.printing_of_edition_id) ?? []), child.id]);
  const toBookEdition = (edition: DemoEdition): DemoBookEdition => {
    const saleIds = new Set([edition.id, ...(childIdsByPublication.get(edition.id) ?? [])]);
    return {
      id: edition.id, title: edition.title, series: edition.series, volumeNumber: edition.volume_number,
      language: edition.language, publisher: edition.publisher, coverUrl: edition.cover_image_url,
      coverStatus: edition.cover_verification_status,
      marketGuide: collectorMarketGuide(sales.filter((sale) => saleIds.has(sale.edition_id))),
    };
  };
  const books: DemoSeriesBook[] = sampleBySeries.map(({ representative, owned, cataloguedVolumes }) => ({
    key: `${representative.series || representative.title || representative.id}::${representative.language || ""}`,
    name: representative.series || representative.title || "Manga series",
    language: representative.language,
    representative: toBookEdition(representative),
    owned: owned.map(toBookEdition),
    cataloguedVolumes,
  }));
  const languages = new Set(selectedEditions.map((edition) => edition.language).filter(Boolean));
  const spotlight = representatives.slice(0, 3);

  return (
    <main className="rar-concept rar-demo-profile">
      <div className="rar-concept-previewbar"><span>RAR design concept · fictional collector profile</span><Link href="/design-concept">Back to the concept ↗</Link></div>
      <header className="rar-concept-header">
        <Link className="rar-concept-logo" href="/design-concept" aria-label="RAR design concept home"><b>R</b><span>RAR</span><small>INDEX</small></Link>
        <nav aria-label="Demo profile sections"><a href="#spotlight">Highlights</a><a href="#shelf">The shelf</a><Link href="/browse">Discover manga</Link></nav>
        <Link className="rar-concept-header-cta" href="/portfolio">Your shelf <span>↗</span></Link>
      </header>

      <section className="rar-demo-hero" aria-labelledby="demo-profile-title">
        <div className="rar-concept-container rar-demo-hero-inner">
          <div className="rar-demo-identity">
            <div className="rar-demo-identity-top"><span className="rar-demo-avatar" aria-hidden="true">O</span><span className="rar-demo-identity-type">PUBLIC SHELF / DESIGN PREVIEW</span></div>
            <p className="rar-demo-handle">@openingchapter <span>· demo profile</span></p>
            <h1 id="demo-profile-title">The Opening<br />Chapter<span>.</span></h1>
            <p className="rar-demo-bio">A manga shelf made to be explored. Open a cover to see its series, selected volumes and the exact editions behind them.</p>
            <div className="rar-demo-stats" aria-label="Demo shelf summary">
              <div><strong>{selectedEditions.length}</strong><span>SAMPLE VOLUMES</span></div>
              <div><strong>{books.length}</strong><span>SERIES</span></div>
              <div><strong>{languages.size}</strong><span>LANGUAGES</span></div>
            </div>
            <p className="rar-demo-disclaimer">Fictional collector, using real verified RAR catalogue covers. The selected volumes are a design sample, not anyone’s actual holdings.</p>
          </div>
          <div className="rar-demo-hero-gallery" aria-hidden="true">
            {spotlight.map((edition, index) => <div className={`rar-demo-hero-book is-${index + 1}`} key={edition.id}>{cover(edition, true)}</div>)}
            <span className="rar-demo-hero-gallery-label">RAR / COLLECTOR SHELVES</span>
          </div>
        </div>
      </section>

      <DemoBookShelf books={books} />

      <section className="rar-demo-join"><div className="rar-concept-container"><div><p className="rar-concept-kicker">MAKE IT YOURS</p><h2>Your manga. Your shelf.</h2><p>Choose what to share. The editions you own can be public; what you paid and your private notes stay yours.</p></div><Link className="rar-concept-button is-primary" href="/portfolio">Build your shelf <span>↗</span></Link></div></section>
    </main>
  );
}
