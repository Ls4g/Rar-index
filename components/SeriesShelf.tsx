"use client";

import Link from "next/link";
import { useState } from "react";
import EditionCover from "@/components/EditionCover";
import type { SeriesProgressEntry, SeriesVolume } from "@/lib/seriesCompletion";

// A collection shown as a shelf, one row per series, volumes in order.
//
// The reference this comes from is a physical bookshelf: books standing on a
// ledge, grouped into rows, and the one you are looking at pulled out to face
// you. That maps onto manga better than onto most things — a manga collection
// IS experienced as a run of spines, in order, with the volume number on each,
// and the thing every collector notices first is the hole where volume 4
// should be.
//
// So the gap is the feature. A grid of covers can only show what someone owns;
// a shelf shows the shape of the run, and RAR is the only place that can draw
// it, because only RAR knows which exact editions exist and which of them are
// missing. Empty slots are drawn at real positions from the catalogue, never
// invented to pad a row out.
//
// Takes SeriesProgressEntry from lib/seriesCompletion.ts unchanged, so the
// public shelf, the portfolio and this view all count the same way.

export default function SeriesShelf({ entries, emptyLabel = "Nothing on the shelf yet." }: {
  entries: SeriesProgressEntry[];
  emptyLabel?: string;
}) {
  const [openVolume, setOpenVolume] = useState<string | null>(null);

  if (!entries.length) return <p className="shelf-empty">{emptyLabel}</p>;

  return (
    <div className="shelf">
      {entries.map((entry) => {
        const missing = entry.volumes.filter((volume) => !volume.owned).length;
        const selected = entry.volumes.find((volume) => volume.editionId === openVolume && volume.owned) ?? null;
        return (
          <section className="shelf-run" key={entry.key}>
            <header className="shelf-run-head">
              <div>
                <h3>{entry.series}</h3>
                {entry.language ? <span className="shelf-run-lang">{entry.language}</span> : null}
              </div>
              {/* Always against what RAR has catalogued, never against the
                  published run — RAR does not always know how long a series
                  is, so it does not claim to. */}
              <p className="shelf-run-count">
                <strong>{entry.owned}</strong> of {entry.tracked} catalogued volume{entry.tracked === 1 ? "" : "s"}
                {missing ? <span className="shelf-run-gapcount"> · {missing} missing</span> : null}
              </p>
            </header>

            {/* The ledge is a real element rather than a border, because the
                books need something to cast a contact shadow onto — that
                shadow is most of what makes them read as standing up. */}
            <div className="shelf-ledge-wrap">
              <ol className="shelf-books" aria-label={`${entry.series} volumes RAR has catalogued`}>
                {entry.volumes.map((volume) => (
                  <ShelfBook
                    key={volume.editionId}
                    onToggle={() => setOpenVolume((current) => (current === volume.editionId ? null : volume.editionId))}
                    open={openVolume === volume.editionId}
                    volume={volume}
                  />
                ))}
              </ol>
              <div className="shelf-ledge" aria-hidden="true" />
            </div>

            {/* The pulled-out book, read below its own shelf rather than in a
                popover: the row scrolls horizontally, and overflow-x also
                clips vertically, so anything floating out of the row gets
                cut in half. */}
            {selected && entry.volumes.some((volume) => volume.editionId === selected.editionId) ? (
              <p className="shelf-selected">
                <strong>{selected.title ?? selected.series}</strong>
                <span>Volume {selected.label && selected.label !== "—" ? selected.label : "?"}{selected.language ? ` · ${selected.language}` : ""}</span>
                <Link href={`/edition/${selected.editionId}`}>Open edition →</Link>
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function ShelfBook({ volume, open, onToggle }: { volume: SeriesVolume; open: boolean; onToggle: () => void }) {
  const label = volume.label && volume.label !== "—" ? volume.label : "?";

  // A missing volume is a slot, not a book. It keeps the footprint so the run
  // reads at its true length, and it is the one thing on the shelf you can act
  // on — which is the whole loop: see the hole, go and fill it.
  if (!volume.owned) {
    return (
      <li className="shelf-slot">
        <Link className="shelf-slot-inner" href={`/edition/${volume.editionId}`} title={`Volume ${label} — not on this shelf`}>
          <span className="shelf-slot-number">{label}</span>
          <span className="shelf-slot-hint">Missing</span>
        </Link>
      </li>
    );
  }

  return (
    <li className={`shelf-book${open ? " is-open" : ""}`}>
      <button
        aria-expanded={open}
        aria-label={`${volume.title ?? volume.series ?? "Volume"} ${label}`}
        className="shelf-book-face"
        onClick={onToggle}
        type="button"
      >
        {/* A real cuboid, not a gradient pretending to be one. The cover is
            the front face; the spine is a second face hinged on its left edge
            and rotated back into the shelf, so turning the book actually
            reveals it. This is what the flat version was missing -- depth you
            can rotate, rather than depth painted on. */}
        <span className="shelf-book-3d">
          <span className="shelf-book-front">
            <EditionCover
              className="shelf-book-cover"
              imageStatus={volume.coverStatus}
              imageUrl={volume.coverImageUrl}
              language={volume.language}
              series={volume.series}
              title={volume.title}
              volumeNumber={volume.volumeNumber}
            />
          </span>
          {/* The spine carries the volume number, which is exactly what a
              manga spine carries on a real shelf. */}
          <span className="shelf-book-spine"><b>{label}</b></span>
        </span>
        <span className="shelf-book-number">{label}</span>
      </button>
    </li>
  );
}
