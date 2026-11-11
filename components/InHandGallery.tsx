"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/fx";
import type { DemoBookEdition } from "@/app/design-concept/collector/DemoBookShelf";

// A gallery where the book is the object, not the room.
//
// The WebGL wall drew a low-polygon room and hung covers about 100px wide in
// the middle of it; the owner's word for the result was "Minecraft-y". Here
// each cover is the front of a real cuboid with a spine and page edges. The
// book in hand turns with the pointer, and flipping it shows RAR's record for
// that edition on the back, so the evidence is the reward for handling it.
//
// Preview only: reached with ?view=in-hand on a collector page. It reads the
// same wallEditions the existing gallery does, so it shows verified covers
// only and nothing about what a collector paid.

function editionTitle(edition: DemoBookEdition) {
  if (edition.title) return edition.title;
  return [edition.series, edition.volumeNumber ? `Vol. ${edition.volumeNumber}` : null].filter(Boolean).join(", ") || "Manga";
}

function editionLine(edition: DemoBookEdition) {
  return [edition.publisher, edition.language].filter(Boolean).join(" · ");
}

function marketCopy(edition: DemoBookEdition) {
  const guide = edition.marketGuide;
  if (!guide) return null;
  return {
    price: formatPrice(guide.median, guide.currency),
    // One sale is not a median; say what it is.
    basis: guide.saleCount === 1
      ? `One verified sale · ${guide.comparisonLabel}`
      : `Median of ${guide.saleCount} verified sales · ${guide.comparisonLabel}`,
  };
}

/** The six faces of one book. Size comes from --w on the wrapper. */
function BookFaces({ edition, back }: { edition: DemoBookEdition; back?: React.ReactNode }) {
  const alt = `Cover of ${editionTitle(edition)}`;
  return (
    <>
      <span className="inhand-face inhand-front">
        {/* Reviewer-approved external catalogue image, as EditionCover uses. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={edition.coverUrl ?? ""} alt={alt} referrerPolicy="no-referrer" draggable={false} />
        <span className="inhand-glare" aria-hidden="true" />
        <span className="inhand-hinge" aria-hidden="true" />
      </span>
      <span className="inhand-face inhand-back">{back}</span>
      {/* The spine has no artwork of its own in the catalogue, so it borrows
          the cover's left edge, blurred: the right colours without inventing
          a spine design. */}
      <span className="inhand-face inhand-spine" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={edition.coverUrl ?? ""} alt="" referrerPolicy="no-referrer" draggable={false} />
      </span>
      <span className="inhand-face inhand-pages" aria-hidden="true" />
      <span className="inhand-face inhand-top" aria-hidden="true" />
      <span className="inhand-face inhand-bottom" aria-hidden="true" />
    </>
  );
}

export default function InHandGallery({
  editions, notes = {}, ownerName, title = "", caption = "",
}: {
  editions: DemoBookEdition[];
  notes?: Record<string, string>;
  ownerName: string;
  title?: string;
  caption?: string;
}) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const count = editions.length;
  const current = editions[Math.min(index, Math.max(0, count - 1))];

  const pick = useCallback((next: number) => {
    setIndex(((next % count) + count) % count);
    setFlipped(false);
  }, [count]);

  // Tilt is written straight to CSS variables. Driving it through React state
  // would re-render the whole rail on every pointer move.
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - 0.5;
    const y = (event.clientY - box.top) / box.height - 0.5;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      stage.classList.add("is-tracking");
      stage.style.setProperty("--ry", `${(x * 56).toFixed(2)}deg`);
      stage.style.setProperty("--rx", `${(y * -26).toFixed(2)}deg`);
      stage.style.setProperty("--glare", `${(50 - x * 90).toFixed(1)}%`);
    });
  }, []);

  const onPointerLeave = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    cancelAnimationFrame(frame.current);
    stage.classList.remove("is-tracking");
    stage.style.setProperty("--ry", "0deg");
    stage.style.setProperty("--rx", "0deg");
    stage.style.setProperty("--glare", "50%");
  }, []);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  if (!current) return null;
  const market = marketCopy(current);
  const note = notes[current.id]?.trim();

  return (
    <section className="inhand" id="gallery" aria-labelledby="inhand-title">
      <div className="inhand-container">
        <header className="inhand-heading">
          <div>
            <p className="inhand-kicker">{ownerName}&rsquo;s gallery</p>
            <h2 id="inhand-title">{title || "In hand"}</h2>
            {caption ? <p className="inhand-caption">{caption}</p> : null}
          </div>
          <p className="inhand-hint">Move over the book to turn it. Flip it to see RAR&rsquo;s record. Pick another from the shelf.</p>
        </header>

        <div className="inhand-main">
          <div className="inhand-stage" ref={stageRef} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave}>
            <span className="inhand-floor" aria-hidden="true" />
            {/* Keyed so each newly picked book plays the pick-up animation. */}
            <div className="inhand-pickup" key={current.id}>
              <div className="inhand-book" data-flipped={flipped ? "true" : "false"}>
                <BookFaces
                  edition={current}
                  back={(
                    <span className="inhand-record" aria-hidden={flipped ? undefined : true}>
                      <span className="inhand-record-kicker">RAR record</span>
                      <strong>{editionTitle(current)}</strong>
                      <span className="inhand-record-rows">
                        <span><small>Series</small>{current.series || "Not recorded"}</span>
                        <span><small>Volume</small>{current.volumeNumber || "Not recorded"}</span>
                        <span><small>Publisher</small>{current.publisher || "Not recorded"}</span>
                        <span><small>Language</small>{current.language || "Not recorded"}</span>
                        <span><small>Sells for</small>{market ? `${market.price} · ${market.basis}` : "No verified sale yet"}</span>
                      </span>
                      <em>What this collector paid is never shown.</em>
                    </span>
                  )}
                />
              </div>
            </div>
          </div>

          <div className="inhand-info">
            <p className="inhand-kicker">In hand · {index + 1} of {count}</p>
            <h3>{editionTitle(current)}</h3>
            {editionLine(current) ? <p className="inhand-edition">{editionLine(current)}</p> : null}
            {note ? <blockquote className="inhand-note">{note}</blockquote> : null}
            <div className="inhand-market">
              <span>What copies sell for</span>
              {market ? <><strong>{market.price}</strong><small>{market.basis}</small></> : <strong className="is-empty">No verified sale yet</strong>}
            </div>
            <div className="inhand-actions">
              <button type="button" className="inhand-primary" onClick={() => setFlipped((value) => !value)} aria-pressed={flipped}>
                {flipped ? "Show the cover" : "Flip to the record"}
              </button>
              <Link className="inhand-secondary" href={`/edition/${current.id}`}>Open edition record</Link>
            </div>
            {count > 1 ? (
              <div className="inhand-steps">
                <button type="button" aria-label="Previous book" onClick={() => pick(index - 1)}>
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <button type="button" aria-label="Next book" onClick={() => pick(index + 1)}>
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="inhand-rail-scroll">
          <div className="inhand-rail-inner">
            <ol className="inhand-rail" aria-label={`${ownerName}'s shelf`}>
              {editions.map((edition, position) => (
                <li key={edition.id}>
                  <button type="button" className="inhand-rail-book" aria-label={`Pick up ${editionTitle(edition)}`} aria-current={position === index ? "true" : undefined} onClick={() => pick(position)}>
                    <BookFaces edition={edition} />
                  </button>
                </li>
              ))}
            </ol>
            <div className="inhand-plank" aria-hidden="true" />
            <ol className="inhand-rail-labels" aria-hidden="true">
              {editions.map((edition, position) => (
                <li key={edition.id} className={position === index ? "is-current" : undefined}>
                  {position === index ? "In hand" : [edition.series, edition.volumeNumber].filter(Boolean).join(" ")}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
