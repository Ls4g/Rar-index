import type { Metadata } from "next";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { supabase } from "@/lib/supabase";
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

function editionLabel(edition: DemoEdition) {
  return edition.series || edition.title || "Manga edition";
}

function editionDetails(edition: DemoEdition) {
  return [edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language, edition.publisher]
    .filter(Boolean).join(" · ");
}

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

function chooseDemoEditions(catalogue: DemoEdition[]) {
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

export default async function DemoCollectorProfilePage() {
  const { data } = await supabase.from("manga_editions")
    .select("id,title,series,volume_number,language,publisher,cover_image_url,cover_verification_status")
    .eq("is_verified", true).eq("record_kind", "publication")
    .eq("cover_verification_status", "verified").not("cover_image_url", "is", null)
    .limit(500);
  const editions = chooseDemoEditions((data ?? []) as DemoEdition[]);
  const spotlight = editions.slice(0, 3);
  const languages = new Set(editions.map((edition) => edition.language).filter(Boolean));

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
            <p className="rar-demo-bio">A manga shelf made to be explored. Covers lead the way; every book opens to the exact edition behind it.</p>
            <div className="rar-demo-stats" aria-label="Demo shelf summary">
              <div><strong>{editions.length}</strong><span>EDITIONS</span></div>
              <div><strong>{editions.length}</strong><span>SERIES</span></div>
              <div><strong>{languages.size}</strong><span>LANGUAGES</span></div>
            </div>
            <p className="rar-demo-disclaimer">Fictional collector, using real verified RAR catalogue covers. These are sample selections, not ownership or valuation claims.</p>
          </div>
          <div className="rar-demo-hero-gallery" aria-hidden="true">
            {spotlight.map((edition, index) => <div className={`rar-demo-hero-book is-${index + 1}`} key={edition.id}>{cover(edition, true)}</div>)}
            <span className="rar-demo-hero-gallery-label">RAR / COLLECTOR SHELVES</span>
          </div>
        </div>
      </section>

      <section className="rar-demo-content" id="spotlight">
        <div className="rar-concept-container">
          <div className="rar-demo-section-heading"><div><p className="rar-concept-kicker">THE EDITORIAL SHELF</p><h2>Stories up front.</h2></div><p>Three covers from the sample shelf, given room to breathe. Select a book to inspect its real catalogue record.</p></div>
          <div className="rar-demo-spotlight-grid">
            {spotlight.map((edition, index) => <Link className="rar-demo-spotlight-card" href={`/edition/${edition.id}`} key={edition.id}>
              <span className="rar-demo-spotlight-number">0{index + 1} / SELECTED EDITION</span>
              <div className="rar-demo-spotlight-image">{cover(edition)}</div>
              <div className="rar-demo-spotlight-footer"><div><strong>{editionLabel(edition)}</strong><span>{editionDetails(edition)}</span></div><span aria-hidden="true">↗</span></div>
            </Link>)}
          </div>
        </div>
      </section>

      <section className="rar-demo-shelf" id="shelf"><div className="rar-concept-container">
        <div className="rar-demo-section-heading"><div><p className="rar-concept-kicker">THE FULL SHELF</p><h2>Every cover has a story.</h2></div><p>{editions.length} sample editions from RAR’s real catalogue. No purchase prices or private notes appear on a public shelf.</p></div>
        <div className="rar-demo-shelf-grid">
          {editions.map((edition) => <Link className="rar-demo-shelf-item" href={`/edition/${edition.id}`} key={edition.id}>
            <div className="rar-demo-shelf-image">{cover(edition)}</div>
            <strong>{editionLabel(edition)}</strong>
            <span>{editionDetails(edition)}</span>
          </Link>)}
        </div>
        <div className="rar-demo-shelf-end"><span>END OF SHELF / {String(editions.length).padStart(2, "0")}</span><a href="#demo-profile-title">Back to the top ↑</a></div>
      </div></section>

      <section className="rar-demo-join"><div className="rar-concept-container"><div><p className="rar-concept-kicker">MAKE IT YOURS</p><h2>Your manga. Your shelf.</h2><p>Choose what to share. The editions you own can be public; what you paid and your private notes stay yours.</p></div><Link className="rar-concept-button is-primary" href="/portfolio">Build your shelf <span>↗</span></Link></div></section>
    </main>
  );
}
