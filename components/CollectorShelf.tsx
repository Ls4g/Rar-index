"use client";

import { useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent } from "react";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { HomePrice } from "@/components/HomeMarketDisplay";
import type { FxRate } from "@/lib/fx";

export type ShelfEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volumeNumber: string | null;
  collectibleType: string | null;
  issueYear: number | null;
  issueNumberLabel: string | null;
  language: string | null;
  editionLabel: string;
  coverImageUrl: string | null;
  coverStatus: string | null;
  verifiedSaleCount: number;
  latestSale: { price: number; currency: string; soldDate: string | null } | null;
};

function formatSaleDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * A manually browsable shelf of verified covers. It never auto-plays, and the
 * selected publication's latest sale follows the homepage currency selector.
 */
export default function CollectorShelf({ editions, rates }: { editions: ShelfEdition[]; rates: FxRate[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = editions[activeIndex] ?? null;

  function goTo(index: number, moveFocus: boolean) {
    const clamped = Math.max(0, Math.min(index, editions.length - 1));
    setActiveIndex(clamped);
    const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
    itemRefs.current[clamped]?.scrollIntoView({ behavior, inline: "center", block: "nearest" });
    if (moveFocus) itemRefs.current[clamped]?.focus({ preventScroll: true });
  }

  function handleTrackKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") { event.preventDefault(); goTo(activeIndex + 1, true); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); goTo(activeIndex - 1, true); }
    else if (event.key === "Home") { event.preventDefault(); goTo(0, true); }
    else if (event.key === "End") { event.preventDefault(); goTo(editions.length - 1, true); }
  }

  if (!editions.length) return null;

  return (
    <div className="collector-shelf">
      <div className="collector-shelf-track" aria-label="Verified catalogue covers" onKeyDown={handleTrackKeyDown}>
        {editions.map((edition, index) => (
          <button
            key={edition.id}
            ref={(element) => { itemRefs.current[index] = element; }}
            type="button"
            aria-pressed={index === activeIndex}
            aria-label={`${edition.title || edition.series || "Edition"}${index === activeIndex ? " — selected" : ""}`}
            className={`collector-shelf-item${index === activeIndex ? " is-active" : ""}`}
            style={{ "--shelf-tilt": `${(index % 2 === 0 ? -1 : 1) * (1.25 + (index % 3) * 0.6)}deg` } as CSSProperties}
            onClick={() => goTo(index, false)}
          >
            <EditionCover
              title={edition.title}
              series={edition.series}
              volumeNumber={edition.volumeNumber}
              descriptor={edition.collectibleType === "zasshi" ? [edition.issueYear, edition.issueNumberLabel ? `Issue ${edition.issueNumberLabel}` : null].filter(Boolean).join(" · ") : null}
              language={edition.language}
              imageUrl={edition.coverImageUrl}
              imageStatus={edition.coverStatus}
              className="collector-shelf-cover"
              priority={index < 4}
            />
          </button>
        ))}
      </div>

      <div className="collector-shelf-controls">
        <button type="button" className="collector-shelf-nav" onClick={() => goTo(activeIndex - 1, false)} disabled={activeIndex === 0} aria-label="Previous cover">←</button>
        <span className="collector-shelf-position">{activeIndex + 1} / {editions.length}</span>
        <button type="button" className="collector-shelf-nav" onClick={() => goTo(activeIndex + 1, false)} disabled={activeIndex === editions.length - 1} aria-label="Next cover">→</button>
      </div>

      {active ? (
        <div className="collector-shelf-detail" aria-live="polite">
          <div>
            <p className="collector-shelf-detail-kicker">{(active.collectibleType === "zasshi"
              ? [active.issueYear, active.issueNumberLabel ? `Issue ${active.issueNumberLabel}` : null, active.language]
              : [active.series, active.volumeNumber ? `Vol. ${active.volumeNumber}` : null, active.language]).filter(Boolean).join(" · ")}</p>
            <h3>{(active.collectibleType === "zasshi" ? active.series : active.title) || "Untitled publication"}</h3>
            <p className="collector-shelf-detail-edition">{active.editionLabel}</p>
          </div>
          <div className="collector-shelf-detail-evidence">
            <div><span>Verified sales</span><strong>{active.verifiedSaleCount}</strong></div>
            <div>
              <span>Latest verified sale</span>
              <strong>{active.latestSale ? <HomePrice value={active.latestSale.price} sourceCurrency={active.latestSale.currency} rateDate={active.latestSale.soldDate} rates={rates} /> : "—"}</strong>
              <small>{active.latestSale ? (formatSaleDate(active.latestSale.soldDate) ?? "Date not recorded") : "No verified sale yet"}</small>
            </div>
          </div>
          <Link className="collector-shelf-detail-link" href={`/edition/${active.id}`}>View edition →</Link>
        </div>
      ) : null}
    </div>
  );
}
