"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/fx";
import type { DemoBookEdition, DemoMarketGuide, DemoSeriesBook } from "./DemoBookShelf";
import type { GalleryTheme } from "@/lib/collectorGalleryTheme";

// The public gallery as books you can handle, replacing the WebGL room.
//
// The room drew a wall, a floor and spotlights around covers about a hundred
// pixels wide, so the architecture was the subject and the manga was not. Here
// one book is large and in the visitor's hand: it turns with the pointer, and
// flipping it shows the catalogue record on the back, so the evidence is the
// reward for handling the book rather than a table beside it. The rest of the
// display stands on a shelf underneath and any of them can be picked up.
//
// Plain CSS 3D on purpose. It needs no WebGL context (the room failed on some
// phones and cost a large script), the covers stay ordinary <img> elements with
// the same no-referrer policy EditionCover uses, and everything is reachable
// by keyboard.

const MAX_TILT_Y = 28;
const MAX_TILT_X = 13;
const TOUCH_TURN_PER_PX = 0.45;
const MAX_TOUCH_TURN = 75;

function marketCopy(guide: DemoMarketGuide | null) {
  return guide
    ? `${formatPrice(guide.median, guide.currency)} · ${guide.comparisonLabel.toLowerCase()} median · ${guide.saleCount} sales`
    : null;
}

function editionName(edition: DemoBookEdition) {
  const series = edition.series || edition.title || "Manga";
  return edition.volumeNumber ? `${series}, Vol. ${edition.volumeNumber}` : series;
}

// Japanese tankobon read right to left, so the spine is on the right of the
// front cover. Showing a Shueisha volume with a left-hand spine would be the
// kind of detail a collector notices at once.
function binding(edition: DemoBookEdition) {
  return edition.language === "Japanese" ? "rtl" : "ltr";
}

function BookFaces({ edition, eager = false }: { edition: DemoBookEdition; eager?: boolean }) {
  const alt = `Cover of ${edition.title || edition.series || "this publication"}`;
  return <>
    <span className="rar-inhand-face rar-inhand-front">
      {/* Reviewer-approved external catalogue image, as in EditionCover. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={edition.coverUrl ?? ""} alt={alt} loading={eager ? "eager" : "lazy"} referrerPolicy="no-referrer" draggable={false} />
      <span className="rar-inhand-glare" aria-hidden="true" />
      <span className="rar-inhand-hinge" aria-hidden="true" />
    </span>
    <span className="rar-inhand-face rar-inhand-spine" aria-hidden="true">
      {/* The strip of the cover beside the spine, so the colours wrap round. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={edition.coverUrl ?? ""} alt="" loading={eager ? "eager" : "lazy"} referrerPolicy="no-referrer" draggable={false} />
    </span>
    <span className="rar-inhand-face rar-inhand-pages" aria-hidden="true" />
    <span className="rar-inhand-face rar-inhand-top" aria-hidden="true" />
    <span className="rar-inhand-face rar-inhand-bottom" aria-hidden="true" />
  </>;
}

export default function GalleryInHand({ wallEditions, ownerName, galleryTitle = "", galleryCaption = "", galleryComments = {}, galleryTheme = "studio" }: {
  books?: DemoSeriesBook[];
  wallEditions: DemoBookEdition[];
  ownerName?: string;
  galleryTitle?: string;
  galleryCaption?: string;
  galleryComments?: Record<string, string>;
  galleryTheme?: GalleryTheme;
  isDemo?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const touch = useRef<{ id: number; startX: number } | null>(null);

  const count = wallEditions.length;
  const safeIndex = count ? Math.min(index, count - 1) : 0;
  const edition = wallEditions[safeIndex];

  // Rotation is written straight to CSS variables, one frame at a time, so
  // turning the book never re-renders the React tree.
  const setTilt = useCallback((x: number, y: number, tracking: boolean) => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      stage.style.setProperty("--rar-tilt-x", `${x.toFixed(2)}deg`);
      stage.style.setProperty("--rar-tilt-y", `${y.toFixed(2)}deg`);
      stage.style.setProperty("--rar-glare", `${(50 - y * 1.6).toFixed(1)}%`);
      stage.dataset.tracking = tracking ? "true" : "false";
    });
  }, []);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const pick = (next: number) => {
    setIndex(((next % count) + count) % count);
    setFlipped(false);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (event.pointerType === "mouse") {
      const box = event.currentTarget.getBoundingClientRect();
      const px = (event.clientX - box.left) / box.width - 0.5;
      const py = (event.clientY - box.top) / box.height - 0.5;
      setTilt(py * -2 * MAX_TILT_X, px * 2 * MAX_TILT_Y, true);
      return;
    }
    if (!touch.current || touch.current.id !== event.pointerId) return;
    const turn = (event.clientX - touch.current.startX) * TOUCH_TURN_PER_PX;
    setTilt(0, Math.max(-MAX_TOUCH_TURN, Math.min(MAX_TOUCH_TURN, turn)), true);
  };

  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;
    touch.current = { id: event.pointerId, startX: event.clientX };
  };

  const release = () => {
    touch.current = null;
    setTilt(0, 0, false);
  };

  if (!edition) return null;

  const name = editionName(edition);
  const market = marketCopy(edition.marketGuide);
  const note = galleryComments[edition.id]?.trim() ?? "";
  const editionLine = [edition.publisher, edition.language].filter(Boolean).join(" · ") || "Edition details not recorded";

  return <section className="rar-inhand" id="gallery" data-gallery-theme={galleryTheme} aria-labelledby="rar-inhand-title">
    <div className="rar-concept-container">
      <div className="rar-inhand-intro">
        <div>
          <p className="rar-inhand-kicker">{ownerName ? `${ownerName.toUpperCase()}’S GALLERY` : "COLLECTOR GALLERY"}</p>
          <h2 id="rar-inhand-title">{galleryTitle.trim() || "Main gallery"}<span>.</span></h2>
          {galleryCaption.trim() ? <p className="rar-inhand-caption">{galleryCaption.trim()}</p> : null}
        </div>
        <p className="rar-inhand-hint">{count} {count === 1 ? "edition" : "editions"} on display. Turn the book, flip it for its record, or pick another off the shelf.</p>
      </div>

      <div className="rar-inhand-main">
        <div className="rar-inhand-stage" ref={stageRef} data-tracking="false" data-flipped={flipped}
          onPointerMove={pointerMove} onPointerDown={pointerDown} onPointerUp={release} onPointerCancel={release} onPointerLeave={release}>
          <span className="rar-inhand-floor" aria-hidden="true" />
          <div className="rar-inhand-book" key={edition.id} data-binding={binding(edition)}>
            <BookFaces edition={edition} eager />
            <div className="rar-inhand-face rar-inhand-back" aria-hidden={!flipped}>
              <span className="rar-inhand-back-kicker">THE RECORD</span>
              <strong>{name}</strong>
              <dl>
                <div><dt>EDITION</dt><dd>{editionLine}</dd></div>
                <div><dt>COVER</dt><dd>Confirmed for this exact edition</dd></div>
                <div><dt>SELLS FOR</dt><dd>{market ?? "No market guide yet. One needs three comparable verified sales."}</dd></div>
              </dl>
              <small>What {ownerName ? `@${ownerName}` : "this collector"} paid is never shown.</small>
            </div>
          </div>
        </div>

        <aside className="rar-inhand-details" aria-label="Edition in hand" aria-live="polite">
          <p className="rar-inhand-kicker">IN HAND · {safeIndex + 1} OF {count}</p>
          <h3>{name}</h3>
          <p className="rar-inhand-edition-line">{editionLine}</p>
          {note ? <div className="rar-inhand-note"><span>FROM @{ownerName}</span><p>{note}</p></div> : null}
          <div className="rar-inhand-market"><span>WHAT COPIES SELL FOR</span><strong>{market ?? "No market guide yet"}</strong></div>
          <div className="rar-inhand-actions">
            <button type="button" className="rar-inhand-flip" aria-pressed={flipped} onClick={() => setFlipped((value) => !value)}>{flipped ? "Show the cover" : "Flip to the record"}</button>
            <Link href={`/edition/${edition.id}`}>Explore the edition <span aria-hidden="true">↗</span></Link>
          </div>
          {count > 1 ? <div className="rar-inhand-step">
            <button type="button" aria-label="Previous book" onClick={() => pick(safeIndex - 1)}><span aria-hidden="true">←</span></button>
            <button type="button" aria-label="Next book" onClick={() => pick(safeIndex + 1)}><span aria-hidden="true">→</span></button>
          </div> : null}
        </aside>
      </div>

      <div className="rar-inhand-shelf-scroll">
        <div className="rar-inhand-shelf" data-few={count <= 5}>
          <div className="rar-inhand-row">
            {wallEditions.map((item, itemIndex) => <button type="button" className="rar-inhand-mini" key={item.id} data-binding={binding(item)}
              aria-label={`Pick up ${editionName(item)}`} aria-current={itemIndex === safeIndex} onClick={() => pick(itemIndex)}>
              <BookFaces edition={item} />
            </button>)}
          </div>
          <div className="rar-inhand-plank" aria-hidden="true" />
        </div>
      </div>

      <div className="rar-inhand-footnote"><span>COLLECTOR’S CHOSEN DISPLAY · VERIFIED RAR COVERS</span><span>{count} ON DISPLAY</span></div>
    </div>
  </section>;
}
