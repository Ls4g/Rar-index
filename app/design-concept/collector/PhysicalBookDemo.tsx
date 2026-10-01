"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
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

function paintLeaf(leaf: HTMLDivElement | null, progress: number) {
  if (!leaf) return;
  leaf.style.transform = `translateZ(13px) rotateY(${-180 * progress}deg)`;
  leaf.style.setProperty("--fold-shadow", `${0.34 * Math.sin(Math.PI * progress)}`);
}

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
  const bookRef = useRef<HTMLDivElement>(null);
  const leafRef = useRef<HTMLDivElement>(null);
  const timers = useRef<number[]>([]);
  const pointerStart = useRef<{ id: number; x: number; width: number; startProgress: number } | null>(null);
  const pageProgress = useRef(0);
  const settleFrame = useRef<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [spread, setSpread] = useState(0);
  const [turning, setTurning] = useState<"next" | "previous" | null>(null);

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
      if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    if (turning) paintLeaf(leafRef.current, pageProgress.current);
  }, [turning]);

  function closeBook() {
    if (isClosing) return;
    if (settleFrame.current !== null) cancelAnimationFrame(settleFrame.current);
    settleFrame.current = null;
    pointerStart.current = null;
    setIsClosing(true);
    setTurning(null);
    setIsOpen(false);
    timers.current.push(window.setTimeout(() => dialogRef.current?.close(), 720));
  }

  function settlePage(target: 0 | 1) {
    const from = pageProgress.current;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === target) {
      pageProgress.current = target;
      setSpread(target);
      setTurning(null);
      return;
    }
    const duration = 260 + Math.abs(target - from) * 750;
    let startedAt: number | null = null;

    function animate(now: number) {
      if (startedAt === null) startedAt = now;
      const elapsed = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      pageProgress.current = from + (target - from) * eased;
      paintLeaf(leafRef.current, pageProgress.current);
      if (elapsed < 1) settleFrame.current = requestAnimationFrame(animate);
      else {
        settleFrame.current = null;
        setSpread(target);
        setTurning(null);
      }
    }

    settleFrame.current = requestAnimationFrame(animate);
  }

  function turnPage(direction: "next" | "previous") {
    if (!isOpen || turning || isClosing || (direction === "next" && spread === 1) || (direction === "previous" && spread === 0)) return;
    pageProgress.current = spread;
    setTurning(direction);
    requestAnimationFrame(() => settlePage(direction === "next" ? 1 : 0));
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!isOpen || isClosing || turning || settleFrame.current !== null || !bookRef.current) return;
    const rect = bookRef.current.getBoundingClientRect();
    const spine = rect.left;
    const width = rect.width;
    const onPage = event.clientY >= rect.top && event.clientY <= rect.bottom && (spread === 0
      ? event.clientX >= spine + width * 0.12 && event.clientX <= spine + width
      : event.clientX <= spine - width * 0.12 && event.clientX >= spine - width);
    if (!onPage) return;
    event.preventDefault();
    pageProgress.current = spread;
    pointerStart.current = { id: event.pointerId, x: event.clientX, width, startProgress: spread };
    setTurning(spread === 0 ? "next" : "previous");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    pageProgress.current = Math.max(0, Math.min(1, start.startProgress + (start.x - event.clientX) / start.width));
    paintLeaf(leafRef.current, pageProgress.current);
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    pointerMove(event);
    pointerStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    settlePage(start.startProgress === 0
      ? pageProgress.current >= 0.42 ? 1 : 0
      : pageProgress.current <= 0.58 ? 0 : 1);
  }

  function pointerCancel(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId) return;
    pointerStart.current = null;
    settlePage(start.startProgress as 0 | 1);
  }

  const featured = book.owned[0];
  const leftSpread = turning ? 0 : spread;
  const rightSpread = turning ? 1 : spread;

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
        <div className="rar-physical-scene-title"><span>01 / 01</span><strong>{book.name}</strong><small>Drag the outer page across the spine</small></div>
        <div className="rar-physical-ground" aria-hidden="true" />
        <div
          className="rar-physical-grab-area"
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerCancel}
          onDragStart={(event) => event.preventDefault()}
          aria-label={`${book.name} book; drag the right page left to advance, or the left page right to go back`}
        >
          <div className="rar-physical-book" ref={bookRef}>
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
            {turning && <div className="rar-physical-turn-leaf" ref={leafRef} aria-hidden="true" style={{ transform: turning === "next" ? "translateZ(13px) rotateY(0deg)" : "translateZ(13px) rotateY(-180deg)" }}>
              <div className="rar-physical-turn-surface is-front"><div className="rar-physical-right-page rar-physical-turn-content"><PageTwoContent book={book} /></div></div>
              <div className="rar-physical-turn-surface is-back"><div className="rar-physical-inside-face rar-physical-turn-content"><PageThreeContent featured={featured} /></div></div>
            </div>}
          </div>
        </div>
      </div>

      <div className="rar-physical-controls">
        <p>{isOpen ? spread === 0 ? "Drag the right page left to turn. Release early to let it fall back." : "Drag the left page right to return. Release early to let it fall back." : "Bringing the book forward…"}</p>
        <div><span aria-live="polite">{spread + 1} / 2</span><small>Keyboard: ← / →</small></div>
      </div>

      <section className="rar-physical-details" aria-label="Readable collection details">
        <div><span>THE SAMPLE COLLECTION</span><h3>{spread === 0 ? `${book.name} volumes` : "Edition & market context"}</h3><p>These selections illustrate a fictional shelf. No ownership, purchase price or private notes are claimed.</p></div>
        {spread === 0 ? <div className="rar-physical-detail-volumes">{book.owned.map((edition) => <Link href={`/edition/${edition.id}`} key={edition.id}><span>VOL. {edition.volumeNumber || "—"}</span><strong>{edition.title || book.name}</strong><small>{edition.publisher || "Publisher not recorded"} · {edition.language || "Language not recorded"}</small><b aria-hidden="true">↗</b></Link>)}</div>
          : <div className="rar-physical-detail-feature"><div>{cover(featured)}</div><section><span>FEATURED EDITION</span><h4>{featured.title || `${book.name} Vol. ${featured.volumeNumber || "—"}`}</h4><p>{guideText(featured)}</p><Link href={`/edition/${featured.id}`}>Open exact RAR edition ↗</Link></section></div>}
      </section>
    </div>
  </dialog>;
}
