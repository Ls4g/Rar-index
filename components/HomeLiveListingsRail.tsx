"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import type { HomeListingCard } from "@/lib/homeLiveListings";

function askingPrice(value: number, currency: string) {
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value); }
  catch { return `${value.toFixed(2)} ${currency}`; }
}

export default function HomeLiveListingsRail({ listings }: { listings: HomeListingCard[] }) {
  const railRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const directionRef = useRef(1);

  function slide(direction: number) {
    const rail = railRef.current;
    const card = rail?.querySelector<HTMLElement>(".rar-concept-live-card");
    if (!rail || !card) return;
    const gap = Number.parseFloat(getComputedStyle(rail).columnGap) || 16;
    rail.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: "smooth" });
  }

  useEffect(() => {
    if (listings.length < 3) return;
    const timer = window.setInterval(() => {
      const rail = railRef.current;
      if (!rail || pausedRef.current || document.hidden || window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 700px)").matches) return;
      const max = rail.scrollWidth - rail.clientWidth;
      if (max < 20) return;
      if (rail.scrollLeft >= max - 8) directionRef.current = -1;
      else if (rail.scrollLeft <= 8) directionRef.current = 1;
      slide(directionRef.current);
    }, 5200);
    return () => window.clearInterval(timer);
  }, [listings.length]);

  return <div className="rar-concept-live-market" onMouseEnter={() => { pausedRef.current = true; }} onMouseLeave={() => { pausedRef.current = false; }} onFocusCapture={() => { pausedRef.current = true; }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) pausedRef.current = false; }}>
    <div className="rar-concept-container rar-concept-live-heading"><div><p>RECENTLY SEEN ON EBAY</p><span>{listings.length} copies to explore</span></div><div className="rar-concept-live-controls"><button aria-label="Previous listings" onClick={() => slide(-1)} type="button">←</button><button aria-label="Next listings" onClick={() => slide(1)} type="button">→</button></div></div>
    <div aria-label="Recently seen manga listings" className="rar-concept-live-rail" ref={railRef}>
      {listings.map((listing) => <article className="rar-concept-live-card" key={listing.id}>
        <Link aria-label={`View RAR edition for ${listing.series || listing.editionTitle || "manga"}`} className="rar-concept-live-cover" href={`/edition/${listing.editionId}`}><EditionCover imageStatus="verified" imageUrl={listing.coverImageUrl} language={listing.language} series={listing.series} title={listing.editionTitle} volumeNumber={listing.volumeNumber} /></Link>
        <p>{[listing.series || listing.editionTitle, listing.volumeNumber ? `Vol. ${listing.volumeNumber}` : null, listing.language].filter(Boolean).join(" · ")}</p>
        <h3><a href={listing.listingUrl} rel="noopener noreferrer" target="_blank">{listing.listingTitle}</a></h3>
        <div className="rar-concept-live-card-bottom"><strong>{askingPrice(listing.askingPrice, listing.currency)} <small>asking</small></strong><a href={listing.listingUrl} rel="noopener noreferrer" target="_blank">Check listing ↗</a></div>
      </article>)}
    </div>
    <p className="rar-concept-container rar-concept-live-note">Seller asking prices, not completed sales. Edition covers are from RAR’s catalogue; check the seller’s photos and availability before buying.</p>
  </div>;
}
