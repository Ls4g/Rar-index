"use client";

import { useState } from "react";
import EditionCover from "@/components/EditionCover";
import type { DemoSeriesBook } from "./DemoBookShelf";

type Props = {
  books: DemoSeriesBook[];
  onOpen: (book: DemoSeriesBook) => void;
};

function position(index: number, activeIndex: number, length: number) {
  let distance = (index - activeIndex + length) % length;
  if (distance > length / 2) distance -= length;
  return distance;
}

export default function GalleryPrototype({ books, onOpen }: Props) {
  const displayed = books.slice(0, 8);
  const [activeIndex, setActiveIndex] = useState(0);
  if (!displayed.length) return null;

  const active = displayed[activeIndex];
  const move = (direction: number) => setActiveIndex((current) => (current + direction + displayed.length) % displayed.length);

  return <section className="rar-gallery" id="gallery" aria-labelledby="rar-gallery-title" onKeyDown={(event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      move(event.key === "ArrowRight" ? 1 : -1);
    }
  }}>
    <div className="rar-concept-container">
      <div className="rar-gallery-intro">
        <div><p className="rar-concept-kicker">THE COLLECTION, ON DISPLAY</p><h2 id="rar-gallery-title">Step inside the shelf<span>.</span></h2></div>
        <p>A first look at a more physical public portfolio. Select a book in the room, then open it to explore its volumes.</p>
      </div>
      <div className="rar-gallery-stage" aria-label="Interactive gallery of sample manga series">
        <div className="rar-gallery-room" aria-hidden="true">
          <div className="rar-gallery-room-back" />
          <div className="rar-gallery-room-left" />
          <div className="rar-gallery-room-right" />
          <div className="rar-gallery-room-floor" />
          <div className="rar-gallery-room-ceiling" />
          <div className="rar-gallery-wall-rail" />
          <div className="rar-gallery-shelf-face" />
          <div className="rar-gallery-shelf-top" />
          <div className="rar-gallery-floor-mark" />
        </div>
        <div className="rar-gallery-stage-label" aria-hidden="true"><b>RAR</b><span>THE OPENING CHAPTER<br />PUBLIC GALLERY / 01</span></div>
        <div className="rar-gallery-books">
          {displayed.map((book, index) => {
            const offset = position(index, activeIndex, displayed.length);
            if (Math.abs(offset) > 2) return null;
            return <button
              className="rar-gallery-book"
              data-position={offset}
              type="button"
              key={book.key}
              onClick={() => offset === 0 ? onOpen(book) : setActiveIndex(index)}
              aria-label={offset === 0 ? `Open ${book.name} book` : `Select ${book.name}`}
              aria-current={offset === 0 ? "true" : undefined}
            >
              <span className="rar-gallery-book-body"><EditionCover
                title={book.representative.title}
                series={book.representative.series}
                volumeNumber={book.representative.volumeNumber}
                language={book.representative.language}
                imageUrl={book.representative.coverUrl}
                imageStatus={book.representative.coverStatus}
              /></span>
              <span className="rar-gallery-book-label">{book.name}</span>
            </button>;
          })}
        </div>
        <div className="rar-gallery-caption" aria-live="polite">
          <span>ON DISPLAY / {String(activeIndex + 1).padStart(2, "0")} OF {String(displayed.length).padStart(2, "0")}</span>
          <h3>{active.name}</h3>
          <p>{active.ownedVolumeCount ?? active.owned.length} sample volumes · {active.language || "Language not recorded"}</p>
          <button type="button" onClick={() => onOpen(active)}>Open this book <span aria-hidden="true">↗</span></button>
        </div>
        <div className="rar-gallery-navigation" aria-label="Choose a displayed series">
          <button type="button" onClick={() => move(-1)} aria-label="Previous series">←</button>
          <button type="button" onClick={() => move(1)} aria-label="Next series">→</button>
        </div>
      </div>
      <div className="rar-gallery-footnote"><span>CLICK A COVER TO BRING IT FORWARD · USE THE ARROWS TO MOVE THROUGH THE ROOM</span><span>FICTIONAL COLLECTOR / REAL RAR COVERS</span></div>
    </div>
  </section>;
}
