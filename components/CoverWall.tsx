"use client";

import { useMemo, useState } from "react";

export type WallCover = { url: string; label: string };

// A wall that is always moving. Columns scroll at different speeds and in
// alternating directions, which is what stops a grid of covers reading as a
// product listing -- the eye never settles into rows.
//
// Covers only. It carries no copy of its own so the page it sits on owns the
// words; the homepage puts its headline beside the wall rather than over it.
//
// Six columns always, with CSS hiding the last two or three on narrow screens.
// Measuring the viewport in an effect would mean rendering the wrong number of
// columns first and correcting after paint, for a decision CSS can simply make.
const COLUMN_COUNT = 6;

export default function CoverWall({ covers }: { covers: WallCover[] }) {
  const [lifted, setLifted] = useState<string | null>(null);

  const columns = useMemo(() => {
    const built: WallCover[][] = Array.from({ length: COLUMN_COUNT }, () => []);
    covers.forEach((cover, index) => built[index % COLUMN_COUNT].push(cover));
    // A short column finishes its loop early and opens a gap, so every column
    // is padded back up to the longest before it is doubled.
    const longest = Math.max(1, ...built.map((column) => column.length));
    return built.map((column) => {
      if (!column.length) return column;
      const padded = [...column];
      let index = 0;
      while (padded.length < longest) { padded.push(column[index % column.length]); index += 1; }
      return padded;
    });
  }, [covers]);

  return (
    <div className="cover-wall">
      <div className="cover-wall-columns" aria-hidden="true">
        {columns.map((column, columnIndex) => (
          <div
            className={`cover-wall-column${columnIndex % 2 ? " is-reverse" : ""}`}
            key={columnIndex}
            // Different speeds per column; the pairing with alternating
            // direction is what keeps rows from re-forming as it loops.
            style={{ animationDuration: `${38 + (columnIndex % 3) * 13}s` }}
          >
            {/* Rendered twice and translated by exactly half its own height,
                so the loop closes seamlessly with nothing measured at runtime. */}
            {[...column, ...column].map((cover, index) => {
              const id = `${columnIndex}-${index}`;
              return (
                /* eslint-disable-next-line @next/next/no-img-element -- publisher CDNs, not configured next/image hosts */
                <img
                  alt=""
                  className={`cover-wall-tile${lifted === id ? " is-lifted" : ""}`}
                  key={id}
                  loading="lazy"
                  onClick={() => setLifted((current) => (current === id ? null : id))}
                  src={cover.url}
                  style={{ transform: `rotate(${(((columnIndex * 7 + index * 3) % 5) - 2) * 0.7}deg)` }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
