"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { buildSeriesProgress, type CatalogueVolume, type SeriesProgressEntry } from "@/lib/seriesCompletion";

// The collection, on the homepage, for whoever is actually looking at it.
//
// Every figure on this panel comes from the signed-in collector's own rows in
// portfolio_holdings, read through the same anon client and the same RLS that
// /portfolio uses -- there is no second source of truth and no second login.
// A visitor who is not signed in sees no collection figures at all, because
// RAR does not have their collection yet and inventing a plausible-looking one
// to fill the space would be the same class of fabrication as inventing a
// price.
//
// The homepage is a server component and Supabase sessions live in the
// browser, so this has to be a client island. It renders nothing but the
// invitation until the session resolves, which means the signed-out state is
// also the pre-hydration state -- correct either way.

const SERIES_SHOWN = 4;

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

export default function HomeShelfPanel() {
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

  // Signed out. No counts, no sample shelf, no silhouette of a collection that
  // isn't theirs.
  if (!shelf) {
    return (
      <section className="home-shelf home-shelf-invite" aria-labelledby="home-shelf-heading">
        <div className="home-shelf-invite-copy">
          <p className="eyebrow">Your shelf</p>
          <h2 id="home-shelf-heading">Nothing here yet — it&apos;s yours to fill</h2>
          <p>
            Add the manga you own and RAR records the exact edition: publisher, ISBN, printing, language.
            You get a run you can see the holes in, a private valuation from completed sales, and a shelf
            you can publish under your own handle.
          </p>
          <div className="home-actions">
            <Link className="home-btn" href="/portfolio">Start your shelf</Link>
            <Link className="home-btn is-quiet" href="/browse">Browse manga</Link>
          </div>
          <p className="home-shelf-note">
            Free, and private by default. Nothing about your collection is published until you switch it on.
          </p>
        </div>
        <ul className="home-shelf-promises">
          <li><strong>The exact edition</strong><span>Not just the title — the printing you actually own.</span></li>
          <li><strong>The gaps in your runs</strong><span>Counted against what RAR has catalogued, never guessed.</span></li>
          <li><strong>What copies really sell for</strong><span>Completed sales with a working link back to the listing.</span></li>
          <li><strong>Yours until you share it</strong><span>Purchase prices and notes never leave your account.</span></li>
        </ul>
      </section>
    );
  }

  const volumes = shelf.ownedEditionIds.length;
  const runs = shelf.series.slice(0, SERIES_SHOWN);

  return (
    <section className="home-shelf" aria-labelledby="home-shelf-heading">
      <div className="home-shelf-head">
        <div>
          <p className="eyebrow">Your shelf</p>
          <h2 id="home-shelf-heading">
            {volumes} volume{volumes === 1 ? "" : "s"} · {shelf.series.length} series
          </h2>
          <p>
            Counted from the editions you have added. Runs below are measured against the volumes RAR has
            catalogued for each series — not the full published run, which RAR does not always know.
          </p>
        </div>
        <div className="home-shelf-head-actions">
          <Link className="home-btn" href="/portfolio">Manage your shelf</Link>
          {shelf.handle && shelf.shelfIsPublic ? (
            <Link className="home-btn is-quiet" href={`/collectors/${shelf.handle}`}>View public shelf</Link>
          ) : null}
        </div>
      </div>

      {volumes === 0 ? (
        <p className="home-shelf-empty">
          You&apos;re signed in, but nothing is on the shelf yet. <Link href="/portfolio">Add your first manga →</Link>
        </p>
      ) : (
        <div className="home-runs">
          {runs.map((entry) => {
            const missing = entry.volumes.filter((volume) => !volume.owned);
            return (
              <article className="home-run" key={entry.key}>
                <div className="home-run-head">
                  <h3>{entry.series}</h3>
                  <span className="home-run-count">
                    {entry.owned} of {entry.tracked} catalogued volume{entry.tracked === 1 ? "" : "s"} owned
                  </span>
                </div>
                {/* One spine per catalogued volume. An owned spine carries the
                    accent; a gap is a hollow slot, which is the thing that
                    nags -- and the thing that gets filled, which is what puts
                    evidence into RAR. */}
                <ol className="home-spines" aria-label={`${entry.series} volumes RAR has catalogued`}>
                  {entry.volumes.map((volume) => (
                    <li className={volume.owned ? "is-owned" : "is-gap"} key={volume.editionId}>
                      <Link
                        href={`/edition/${volume.editionId}`}
                        title={`${volume.title ?? entry.series} — ${volume.owned ? "on your shelf" : "not on your shelf"}`}
                      >
                        <span>{volume.label}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
                {missing.length ? (
                  <p className="home-run-gap">
                    Missing <b>{missing.slice(0, 6).map((volume) => `Vol. ${volume.label}`).join(", ")}</b>
                    {missing.length > 6 ? ` and ${missing.length - 6} more` : ""}
                  </p>
                ) : (
                  // Never "complete". RAR holding every volume it knows about
                  // is a statement about RAR's catalogue, not about the series.
                  <p className="home-run-gap is-complete">No gaps in what RAR has catalogued so far</p>
                )}
              </article>
            );
          })}
        </div>
      )}

      {shelf.series.length > SERIES_SHOWN ? (
        <p className="home-shelf-note">
          Showing {SERIES_SHOWN} of your {shelf.series.length} series. <Link href="/portfolio">See them all →</Link>
        </p>
      ) : null}
    </section>
  );
}
