"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { buildSeriesProgress, type CatalogueVolume, type SeriesProgressEntry } from "@/lib/seriesCompletion";
import EditionCover from "@/components/EditionCover";

// The collection, on the homepage, for whoever is actually looking at it.
//
// Every figure on this panel comes from the signed-in collector's own rows in
// portfolio_holdings, read through the same anon client and the same RLS that
// /portfolio uses -- there is no second source of truth and no second login.
// A visitor who is not signed in sees a clearly labelled product preview made
// from real catalogue covers. Its example statuses are never counted as that
// visitor's holdings and never touch collection or market data.
//
// The homepage is a server component and Supabase sessions live in the
// browser, so this has to be a client island. It renders nothing but the
// invitation until the session resolves, which means the signed-out state is
// also the pre-hydration state -- correct either way.

type HoldingRow = {
  edition_id: string;
  edition: {
    id: string;
    series: string | null;
    title: string | null;
    volume_number: string | null;
    language: string | null;
    cover_image_url: string | null;
    cover_verification_status: string | null;
  } | null;
};

type ShelfState = {
  ownedEditionIds: string[];
  series: SeriesProgressEntry[];
  handle: string | null;
  shelfIsPublic: boolean;
};

export type ShelfShowcaseVolume = {
  id: string;
  title: string | null;
  series: string | null;
  volumeNumber: string;
  language: string | null;
  coverImageUrl: string | null;
  coverStatus: string | null;
};

export default function HomeShelfPanel({ showcase = [] }: { showcase?: ShelfShowcaseVolume[] }) {
  const [signedIn, setSignedIn] = useState(false);
  const [shelf, setShelf] = useState<ShelfState | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const user = sessionData.session?.user;
      if (!active) return;
      if (!user) {
        setSignedIn(false);
        setShelf(null);
        return;
      }
      setSignedIn(true);

      const [{ data: holdingData }, { data: profileData }] = await Promise.all([
        supabase
          .from("portfolio_holdings")
          .select("edition_id,edition:manga_editions(id,series,title,volume_number,language,cover_image_url,cover_verification_status)"),
        supabase.from("collector_profiles").select("username,shelf_is_public").eq("user_id", user.id).maybeSingle(),
      ]);
      if (!active) return;

      const holdings = (holdingData ?? []) as unknown as HoldingRow[];
      const profile = profileData as { username: string | null; shelf_is_public: boolean } | null;
      const ownedEditionIds = [...new Set(holdings.map((holding) => holding.edition_id))];

      // Every catalogued volume of the series this collector has started, so
      // "4 of 9" can be counted against something real. Scoped to their own
      // series exactly as /portfolio does it, rather than pulling the whole
      // catalogue onto the homepage.
      const startedSeries = [...new Set(holdings.flatMap((holding) => (holding.edition?.series ? [holding.edition.series] : [])))];
      const { data: catalogueData } = startedSeries.length
        ? await supabase
          .from("manga_editions")
          .select("id,title,series,volume_number,language,cover_image_url,cover_verification_status")
          .in("series", startedSeries)
          .eq("is_verified", true)
          .eq("record_kind", "publication")
        : { data: [] };
      if (!active) return;

      const catalogue: CatalogueVolume[] = ((catalogueData ?? []) as Array<{
        id: string; title: string | null; series: string | null; volume_number: string | null;
        language: string | null; cover_image_url: string | null; cover_verification_status: string | null;
      }>).map((row) => ({
        id: row.id,
        title: row.title,
        series: row.series,
        volumeNumber: row.volume_number,
        language: row.language,
        coverImageUrl: row.cover_image_url,
        coverStatus: row.cover_verification_status,
      }));

      setShelf({
        ownedEditionIds,
        // Only series they have actually started -- a run they own nothing
        // from is a catalogue listing, not progress.
        series: buildSeriesProgress(catalogue, ownedEditionIds).filter((entry) => entry.owned > 0),
        handle: profile?.username ?? null,
        shelfIsPublic: Boolean(profile?.shelf_is_public),
      });
    }

    void load();
    const { data: listener } = supabase.auth.onAuthStateChange(() => { void load(); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  // Signed in, holdings still loading. Without this the invitation below would
  // flash "Nothing here yet" at a collector who has three hundred volumes,
  // because the session resolves before their holdings do.
  if (signedIn && !shelf) {
    return (
      <section className="home-shelf" aria-labelledby="home-shelf-heading">
        <div className="home-shelf-head">
          <div>
            <p className="eyebrow">Your shelf</p>
            <h2 id="home-shelf-heading">Loading your shelf…</h2>
          </div>
        </div>
      </section>
    );
  }

  // Signed-out visitors see a clearly labelled product preview built from
  // real catalogue covers. It demonstrates the shelf interaction without
  // presenting the example statuses as the visitor's own holdings.
  if (!shelf) {
    const showcaseByVolume = new Map(showcase.map((volume) => [volume.volumeNumber, volume]));
    const previewSlots = ["1", "2", "3", "4", "5", "6", "7", "8"];
    return (
      <section className="home-shelf home-shelf-invite" aria-labelledby="home-shelf-heading">
        <div className="home-shelf-invite-copy">
          <p className="eyebrow">Your collection, your way</p>
          <h2 id="home-shelf-heading">See the whole shelf.<mark>Spot every gap.</mark></h2>
          <p>
            Add manga as you collect, organise complete runs, and keep a reading list that actually feels manageable.
          </p>
          <ul className="home-shelf-promises">
            <li><b>1</b><strong>Track</strong><span>Keep every volume in one place.</span></li>
            <li><b>2</b><strong>Curate</strong><span>Make shelves for favourites, genres, and reading plans.</span></li>
            <li><b>3</b><strong>Share</strong><span>Publish a collection profile when you&apos;re ready.</span></li>
          </ul>
        </div>
        <article className="home-shelf-demo" aria-label="Example Dragon Ball collection shelf">
          <header>
            <div><small>Shelf preview</small><h3>Dragon Ball</h3></div>
            <Link href="/portfolio">Manage shelf</Link>
          </header>
          <ol>
            {previewSlots.map((slot) => {
              const volume = showcaseByVolume.get(slot);
              const missing = slot === "4" || slot === "7";
              const read = slot === "3" || slot === "8";
              return (
                <li className={missing ? "is-missing" : ""} key={slot}>
                  {missing ? <Link href="/browse" className="home-shelf-gap"><span>{slot}</span></Link> : volume ? (
                    <Link href={`/edition/${volume.id}`}>
                      <EditionCover className="home-shelf-demo-cover" imageStatus={volume.coverStatus} imageUrl={volume.coverImageUrl} language={volume.language} series={volume.series} title={volume.title} volumeNumber={volume.volumeNumber} />
                    </Link>
                  ) : <Link href="/browse" className="home-shelf-gap"><span>{slot}</span></Link>}
                  <p className={missing ? "is-missing" : read ? "is-read" : "is-owned"}><i aria-hidden="true">{missing ? "−" : read ? "▮▮" : "✓"}</i>{missing ? "Missing" : read ? "Read" : "Owned"}</p>
                </li>
              );
            })}
          </ol>
          <small className="home-shelf-demo-note">Example statuses · your shelf stays private until you choose to share it.</small>
        </article>
      </section>
    );
  }

  const volumes = shelf.ownedEditionIds.length;
  const activeRun = shelf.series[0] ?? null;

  return (
    <section className="home-shelf home-shelf-invite" aria-labelledby="home-shelf-heading">
      <div className="home-shelf-invite-copy">
        <p className="eyebrow">Your collection, your way</p>
        <h2 id="home-shelf-heading">See the whole shelf.<mark>Spot every gap.</mark></h2>
        <p>{volumes ? `${volumes} volume${volumes === 1 ? "" : "s"} across ${shelf.series.length} series — organised from the exact editions you added.` : "Your shelf is ready. Add your first volume and start building a run."}</p>
        <ul className="home-shelf-promises">
          <li><b>1</b><strong>Track</strong><span>Keep every volume in one place.</span></li>
          <li><b>2</b><strong>Curate</strong><span>See progress and the gaps RAR can identify.</span></li>
          <li><b>3</b><strong>Share</strong><span>{shelf.shelfIsPublic ? "Your public shelf is ready to share." : "Publish only when you choose to."}</span></li>
        </ul>
      </div>

      <article className="home-shelf-demo is-real" aria-label="Your collection shelf">
        <header>
          <div><small>Your shelf</small><h3>{activeRun?.series ?? "Start a shelf"}</h3></div>
          <div className="home-shelf-demo-actions">
            {shelf.handle && shelf.shelfIsPublic ? <Link href={`/collectors/${shelf.handle}`}>Share shelf</Link> : null}
            <Link href="/portfolio">Manage shelf</Link>
          </div>
        </header>
        {activeRun ? (
          <ol>
            {activeRun.volumes.slice(0, 8).map((volume) => (
              <li className={volume.owned ? "" : "is-missing"} key={volume.editionId}>
                {volume.owned ? (
                  <Link href={`/edition/${volume.editionId}`}>
                    <EditionCover className="home-shelf-demo-cover" imageStatus={volume.coverStatus} imageUrl={volume.coverImageUrl} language={volume.language} series={volume.series} title={volume.title} volumeNumber={volume.volumeNumber} />
                  </Link>
                ) : <Link href={`/edition/${volume.editionId}`} className="home-shelf-gap"><span>{volume.label}</span></Link>}
                <p className={volume.owned ? "is-owned" : "is-missing"}><i aria-hidden="true">{volume.owned ? "✓" : "−"}</i>{volume.owned ? "Owned" : "Missing"}</p>
              </li>
            ))}
          </ol>
        ) : <div className="home-shelf-demo-empty"><p>No manga here yet.</p><Link href="/browse">Find your first volume →</Link></div>}
        <small className="home-shelf-demo-note">{activeRun ? `${activeRun.owned} of ${activeRun.tracked} volumes RAR currently catalogues in this run.` : "Private by default."}</small>
      </article>
    </section>
  );
}
