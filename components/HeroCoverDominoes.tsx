import type { CSSProperties } from "react";
import EditionCover from "@/components/EditionCover";
import type { ShelfEdition } from "@/components/CollectorShelf";

function CoverWing({ editions, side }: { editions: ShelfEdition[]; side: "left" | "right" }) {
  return (
    <div className={`hero-cover-wing is-${side}`}>
      {editions.map((edition, index) => (
        <div
          className="hero-cover-domino"
          key={edition.id}
          style={{ "--hero-cover-order": index } as CSSProperties}
        >
          <EditionCover
            title={edition.title}
            series={edition.series}
            volumeNumber={edition.volumeNumber}
            descriptor={edition.collectibleType === "zasshi"
              ? [edition.issueYear, edition.issueNumberLabel ? `Issue ${edition.issueNumberLabel}` : null].filter(Boolean).join(" · ")
              : null}
            language={edition.language}
            imageUrl={edition.coverImageUrl}
            imageStatus={edition.coverStatus}
            className="hero-cover-art"
          />
        </div>
      ))}
    </div>
  );
}

/**
 * Verified catalogue covers frame the homepage promise like receding display
 * objects. They are deliberately decorative: the interactive, accessible
 * version of the same catalogue remains the collector shelf immediately below.
 */
export default function HeroCoverDominoes({ editions }: { editions: ShelfEdition[] }) {
  const left: ShelfEdition[] = [];
  const right: ShelfEdition[] = [];
  editions.forEach((edition, index) => (index % 2 === 0 ? left : right).push(edition));

  if (!left.length || !right.length) return null;

  return (
    <div className="hero-cover-scene" aria-hidden="true">
      <CoverWing editions={left} side="left" />
      <CoverWing editions={right} side="right" />
    </div>
  );
}
