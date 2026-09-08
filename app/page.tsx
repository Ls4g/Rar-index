/* eslint-disable @next/next/no-img-element -- tiny verified-cover avatars use heterogeneous remote hosts */
import type { CSSProperties } from "react";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import HomeShelfPanel, { type ShelfShowcaseVolume } from "@/components/HomeShelfPanel";
import PublicHeader from "@/components/PublicHeader";
import type { Manga } from "@/components/MangaSearch";
import { publisherDisplayName } from "@/lib/editionDisplay";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function formatDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function seriesKey(edition: Manga) {
  return (edition.series || edition.title || String(edition.id)).toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default async function Home() {
  const admin = getSupabaseAdmin();
  const [{ data: catalogueData }, { data: spotlightSelectionData }] = await Promise.all([
    supabase
      .from("manga_editions")
      .select("id,title,series,volume_number,author,publisher,language,country,isbn_13,format,release_date,edition_statement,printing_number,variant_name,collectible_type,cover_image_url,cover_verification_status,issue_year,issue_number_label,cumulative_issue_no,madb_id")
      .eq("is_verified", true)
      .eq("record_kind", "publication")
      .not("cover_image_url", "is", null)
      .limit(500),
    admin
      .from("homepage_feature_selections")
      .select("edition_id,accent_color")
      .eq("slot", "edition_of_week")
      .order("selected_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const catalogue = (catalogueData ?? []) as Manga[];
  const selection = spotlightSelectionData as { edition_id: string; accent_color: string } | null;
  const spotlight = catalogue.find((edition) => String(edition.id) === selection?.edition_id)
    ?? catalogue.find((edition) => edition.isbn_13 === "9781569319208" && edition.language === "English")
    ?? catalogue[0]
    ?? null;
  const spotlightAccent = selection?.accent_color ?? "#e00e1b";

  const seenSeries = new Set<string>();
  const discoverEditions = catalogue
    .filter((edition) => edition.cover_verification_status === "verified" && edition.cover_image_url)
    .filter((edition) => {
      const key = seriesKey(edition);
      if (seenSeries.has(key)) return false;
      seenSeries.add(key);
      return true;
    })
    .slice(0, 8);

  const dragonBallShowcase: ShelfShowcaseVolume[] = catalogue
    .filter((edition) => edition.series === "Dragon Ball" && edition.language === "English" && edition.volume_number && Number(edition.volume_number) >= 1 && Number(edition.volume_number) <= 8)
    .sort((left, right) => Number(left.volume_number) - Number(right.volume_number))
    .filter((edition, index, rows) => rows.findIndex((candidate) => candidate.volume_number === edition.volume_number) === index)
    .map((edition) => ({
      id: String(edition.id), title: edition.title, series: edition.series, volumeNumber: String(edition.volume_number),
      language: edition.language, coverImageUrl: edition.cover_image_url, coverStatus: edition.cover_verification_status,
    }));

  return (
    <main className="public-page home-page">
      <PublicHeader />

      <section className="home-hero" id="top">
        <div className="home-hero-copy">
          <p className="eyebrow">Your shelf, your story</p>
          <h1>Track your manga. <mark>Show off your collection.</mark></h1>
          <p className="home-lede">Build a home for every volume. Organise your library, create shelves, and share what you love.</p>
          <div className="home-actions">
            <Link className="home-btn" href="/portfolio">Start your collection</Link>
            <Link className="home-btn is-quiet" href="/collection">Explore collections</Link>
          </div>
          <div className="home-collector-note">
            <div>{discoverEditions.slice(0, 5).map((edition) => <img alt="" src={edition.cover_image_url!} key={String(edition.id)} />)}</div>
            <span>A home for manga fans, by manga fans.</span>
          </div>
        </div>

        {spotlight ? (
          <article className="home-spotlight" style={{ "--spotlight-accent": spotlightAccent } as CSSProperties}>
            <div className="home-spotlight-sketch" aria-hidden="true" />
            <div className="home-spotlight-cover-wrap">
              <span className="home-book-depth" aria-hidden="true" />
              <EditionCover className="home-spotlight-cover" imageStatus={spotlight.cover_verification_status} imageUrl={spotlight.cover_image_url} language={spotlight.language} priority series={spotlight.series} title={spotlight.title} volumeNumber={spotlight.volume_number} />
            </div>
            <div className="home-spotlight-copy">
              <p className="eyebrow">Edition of the week</p>
              <h2>{spotlight.title || spotlight.series}</h2>
              <p>{[spotlight.volume_number ? `Volume ${spotlight.volume_number}` : null, publisherDisplayName(spotlight.publisher ?? null), spotlight.format, formatDate(spotlight.release_date ?? null)].filter(Boolean).join(" · ")}</p>
              <Link href={`/portfolio?edition=${spotlight.id}`}>Add to collection <span>→</span></Link>
            </div>
          </article>
        ) : null}
      </section>

      <section className="home-discovery-rail" aria-labelledby="discover-heading">
        <div className="home-discovery-heading">
          <div><p className="eyebrow">Discover more manga</p><h2 id="discover-heading">Find the next <mark>volume you&apos;ll love.</mark></h2></div>
          <Link href="/browse">Browse all <span>→</span></Link>
        </div>
        <div className="home-cover-shelf" aria-label="Manga from the RAR catalogue">
          {discoverEditions.map((edition, index) => (
            <Link className="home-floating-book" href={`/edition/${edition.id}`} key={String(edition.id)} style={{ "--book-index": index } as CSSProperties}>
              <span aria-hidden="true" />
              <EditionCover imageStatus={edition.cover_verification_status} imageUrl={edition.cover_image_url} language={edition.language} series={edition.series} title={edition.title} volumeNumber={edition.volume_number} />
            </Link>
          ))}
        </div>
      </section>

      <HomeShelfPanel showcase={dragonBallShowcase} />

      <section className="home-context-band" id="about" aria-labelledby="context-heading">
        <div className="home-context-title"><p className="eyebrow">RAR knows the difference</p><h2 id="context-heading">More context, when you want it.</h2></div>
        <ul>
          <li><i aria-hidden="true">▤</i><div><strong>Exact editions</strong><span>Publisher, format, printing, and ISBN.</span></div></li>
          <li><i aria-hidden="true">⌕</i><div><strong>Completed sales</strong><span>Only evidence matched to the correct edition.</span></div></li>
          <li><i aria-hidden="true">↗</i><div><strong>Source linked</strong><span>Every verified result keeps its original receipt.</span></div></li>
        </ul>
        <Link className="home-btn" href="/portfolio">Start your collection <span>→</span></Link>
      </section>

      <footer><span>RAR Index</span><small>Track your manga. Know your edition.</small></footer>
    </main>
  );
}
