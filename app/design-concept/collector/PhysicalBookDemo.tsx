"use client";

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { formatPrice } from "@/lib/fx";
import type { DemoBookEdition, DemoSeriesBook } from "./DemoBookShelf";

function cover(edition: DemoBookEdition) {
  return <EditionCover
    title={edition.title}
    series={edition.series}
    volumeNumber={edition.volumeNumber}
    language={edition.language}
    imageUrl={edition.coverUrl}
    imageStatus={edition.coverStatus}
    priority
  />;
}

function guideText(edition: DemoBookEdition) {
  const guide = edition.marketGuide;
  return guide
    ? `${formatPrice(guide.median, guide.currency)} · ${guide.comparisonLabel.toLowerCase()} median from ${guide.saleCount} verified sales`
    : "No comparable price guide yet";
}

const TURN_STRIPS = 24;
const TURN_DURATION_MS = 1450;

function PageTwoContent({ book }: { book: DemoSeriesBook }) {
  return <>
    <span className="rar-physical-folio">02 / COLLECTOR VOLUMES</span>
    <h3>On this shelf<span>.</span></h3>
    <p>{book.owned.length} sample volumes, each linked to its exact RAR edition.</p>
    <div className="rar-physical-mini-volumes">
      {book.owned.map((edition) => <div key={edition.id}><span>{String(edition.volumeNumber || "—").padStart(2, "0")}</span><strong>{edition.title || `${book.name} Vol. ${edition.volumeNumber || "—"}`}</strong></div>)}
    </div>
    <span className="rar-physical-page-number">02</span>
  </>;
}

function PageThreeContent({ featured }: { featured: DemoBookEdition }) {
  return <>
    <span className="rar-physical-folio">03 / A CLOSER LOOK</span>
    <strong className="rar-physical-inside-title">Volume<br />{featured.volumeNumber || "—"}<span>.</span></strong>
    <p>{featured.publisher || "Publisher not recorded"}<br />{featured.language || "Language not recorded"}</p>
    <p>Open the exact edition below for its full catalogue record and verified sales.</p>
    <span className="rar-physical-page-number">03</span>
  </>;
}

export default function PhysicalBookDemo({ book, onClose }: { book: DemoSeriesBook; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [spread, setSpread] = useState(0);
  const [turning, setTurning] = useState<"next" | "previous" | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    timers.current.push(window.setTimeout(() => setIsOpen(true), 470));
    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (!turning || !leafRef.current) return;
    const strips = Array.from(leafRef.current.querySelectorAll<HTMLElement>(".rar-physical-turn-strip"));
    const stripWidth = leafRef.current.getBoundingClientRect().width / TURN_STRIPS;
    let frame = 0;
    let startedAt: number | null = null;

    function animate(now: number) {
      if (startedAt === null) startedAt = now;
      const progress = Math.min((now - startedAt) / TURN_DURATION_MS, 1);
      const eased = (1 - Math.cos(Math.PI * progress)) / 2;
      const baseAngle = turning === "next" ? -Math.PI * eased : -Math.PI * (1 - eased);
      const curl = 0.75 * Math.sin(Math.PI * eased) * (turning === "next" ? -1 : 1);
      let x = 0;
      let z = 0;

      strips.forEach((strip, index) => {
        const angle = baseAngle + curl * ((index + 0.5) / TURN_STRIPS);
        strip.style.transform = `translate3d(${x}px, 0, ${z}px) rotateY(${angle}rad)`;
        strip.style.setProperty("--curl-depth", `${Math.abs(curl) * (index / TURN_STRIPS)}`);
        strip.style.setProperty("--strip-shade", `${0.16 * Math.sin(Math.PI * eased) * ((index + 1) / TURN_STRIPS)}`);
        x += Math.cos(angle) * stripWidth;
        z -= Math.sin(angle) * stripWidth;
      });

      if (progress < 1) frame = requestAnimationFrame(animate);
      else {
        setSpread(turning === "next" ? 1 : 0);
        setTurning(null);
      }
    }

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [turning]);

  function closeBook() {
    if (isClosing) return;
    setIsClosing(true);
    setTurning(null);
    setIsOpen(false);
    timers.current.push(window.setTimeout(() => dialogRef.current?.close(), 720));
  }

  function turnPage(direction: "next" | "previous") {
    if (!isOpen || turning || isClosing || (direction === "next" && spread === 1) || (direction === "previous" && spread === 0)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSpread(direction === "next" ? 1 : 0);
      return;
    }
    setTurning(direction);
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointerStart.current) return;
    const dx = event.clientX - pointerStart.current.x;
    const dy = event.clientY - pointerStart.current.y;
    setDrag({ x: Math.max(-14, Math.min(14, dx / 11)), y: Math.max(-7, Math.min(7, -dy / 16)) });
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!pointerStart.current) return;
    const dx = event.clientX - pointerStart.current.x;
    pointerStart.current = null;
    setDrag({ x: 0, y: 0 });
    if (Math.abs(dx) > 65 && event.pointerType === "touch") turnPage(dx < 0 ? "next" : "previous");
  }

  const featured = book.owned[0];
  const leftSpread = turning ? 0 : spread;
  const rightSpread = turning ? 1 : spread;
  const physicalStyle = {
    "--rar-drag-x": `${drag.x}deg`,
    "--rar-drag-y": `${drag.y}deg`,
  } as CSSProperties;

  return <dialog
    ref={dialogRef}
    className="rar-physical-dialog"
    aria-label={`Explore ${book.name} as a book`}
    onClose={onClose}
    onKeyDown={(event) => {
      if (event.key === "ArrowRight") turnPage("next");
      if (event.key === "ArrowLeft") turnPage("previous");
    }}
  >
    <div className="rar-physical-shell" data-open={isOpen} data-closing={isClosing} data-spread={spread} data-turning={turning || "none"}>
      <header className="rar-physical-header">
        <span>RAR / THE OPENING CHAPTER <small>ONE-BOOK INTERACTION STUDY</small></span>
        <button type="button" onClick={closeBook} autoFocus aria-label="Close the book demo">Close <span aria-hidden="true">✕</span></button>
      </header>

      <div className="rar-physical-scene">
        <div className="rar-physical-scene-title"><span>01 / 01</span><strong>{book.name}</strong><small>Drag to tilt · turn a page · inspect an edition</small></div>
        <div className="rar-physical-ground" aria-hidden="true" />
        <div
          className="rar-physical-grab-area"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
          aria-label={`${book.name} physical book preview`}
        >
          <div className="rar-physical-book" style={physicalStyle}>
            <div className="rar-physical-back-cover" aria-hidden="true" />
            <div className="rar-physical-page-block" aria-hidden="true" />
            <div className="rar-physical-spine" aria-hidden="true"><span>{book.name}</span><b>RAR</b></div>
            <div className="rar-physical-right-page">
              {rightSpread === 0 ? <PageTwoContent book={book} /> : <>
                <span className="rar-physical-folio">04 / MARKET CONTEXT</span>
                <h3>Follow the evidence<span>.</span></h3>
                <div className="rar-physical-feature-cover">{cover(featured)}</div>
                <p className="rar-physical-market-copy">{guideText(featured)}</p>
                <small>Only completed, verified, comparable sales can form a guide. This is not the value of a particular collector’s copy.</small>
                <span className="rar-physical-page-number">04</span>
              </>}
            </div>
            <div className="rar-physical-front-cover">
              <div className="rar-physical-front-face">{cover(book.representative)}<span className="rar-physical-cover-sheen" /></div>
              <div className="rar-physical-inside-face">
                {leftSpread === 0 ? <>
                  <span className="rar-physical-folio">01 / A PERSONAL SHELF</span>
                  <strong className="rar-physical-inside-title">The Opening<br />Chapter<span>.</span></strong>
                  <p>Every collection starts somewhere. This one begins with {book.name}.</p>
                  <div className="rar-physical-inside-stats"><b>{book.owned.length}</b><span>sample volumes selected</span><b>{book.cataloguedVolumes}</b><span>distinct volumes catalogued on RAR</span></div>
                  <span className="rar-physical-page-number">01</span>
                </> : <PageThreeContent featured={featured} />}
              </div>
            </div>
            {turning && <div className="rar-physical-turn-leaf" ref={leafRef} aria-hidden="true">
              {Array.from({ length: TURN_STRIPS }, (_, index) => <div
                className="rar-physical-turn-strip"
                key={index}
                style={{ transform: turning === "next" ? `translateX(${index * 100}%)` : `translateX(-${(index + 1) * 100}%) rotateY(-180deg)` }}
              >
                <div className="rar-physical-turn-surface is-front"><div className="rar-physical-right-page rar-physical-turn-content" style={{ left: `${-index * 100}%` }}><PageTwoContent book={book} /></div></div>
                <div className="rar-physical-turn-surface is-back"><div className="rar-physical-inside-face rar-physical-turn-content" style={{ left: `${-(TURN_STRIPS - index - 1) * 100}%` }}><PageThreeContent featured={featured} /></div></div>
              </div>)}
            </div>}
          </div>
        </div>
      </div>

      <div className="rar-physical-controls">
        <p>{isOpen ? "A fictional collector, using real verified RAR catalogue covers." : "Bringing the book forward…"}</p>
        <div><button type="button" onClick={() => turnPage("previous")} disabled={!isOpen || spread === 0 || Boolean(turning)}>← Previous</button><span>{spread + 1} / 2</span><button type="button" onClick={() => turnPage("next")} disabled={!isOpen || spread === 1 || Boolean(turning)}>Next page →</button></div>
      </div>

      <section className="rar-physical-details" aria-label="Readable collection details">
        <div><span>THE SAMPLE COLLECTION</span><h3>{spread === 0 ? `${book.name} volumes` : "Edition & market context"}</h3><p>These selections illustrate a fictional shelf. No ownership, purchase price or private notes are claimed.</p></div>
        {spread === 0 ? <div className="rar-physical-detail-volumes">{book.owned.map((edition) => <Link href={`/edition/${edition.id}`} key={edition.id}><span>VOL. {edition.volumeNumber || "—"}</span><strong>{edition.title || book.name}</strong><small>{edition.publisher || "Publisher not recorded"} · {edition.language || "Language not recorded"}</small><b aria-hidden="true">↗</b></Link>)}</div>
          : <div className="rar-physical-detail-feature"><div>{cover(featured)}</div><section><span>FEATURED EDITION</span><h4>{featured.title || `${book.name} Vol. ${featured.volumeNumber || "—"}`}</h4><p>{guideText(featured)}</p><Link href={`/edition/${featured.id}`}>Open exact RAR edition ↗</Link></section></div>}
      </section>
    </div>
  </dialog>;
}
