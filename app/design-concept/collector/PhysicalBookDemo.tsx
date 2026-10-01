"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { formatPrice } from "@/lib/fx";
import type { DemoBookEdition, DemoSeriesBook } from "./DemoBookShelf";
import type { PageFlip } from "page-flip/dist/js/page-flip.module.js";

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

function PageOneContent({ book }: { book: DemoSeriesBook }) {
  return <>
    <span className="rar-physical-folio">01 / A PERSONAL SHELF</span>
    <strong className="rar-physical-inside-title">The Opening<br />Chapter<span>.</span></strong>
    <p>Every collection starts somewhere. This one begins with {book.name}.</p>
    <div className="rar-physical-inside-stats"><b>{book.owned.length}</b><span>sample volumes selected</span><b>{book.cataloguedVolumes}</b><span>distinct volumes catalogued on RAR</span></div>
    <span className="rar-physical-page-number">01</span>
  </>;
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

function PageFourContent({ featured }: { featured: DemoBookEdition }) {
  return <>
    <span className="rar-physical-folio">04 / MARKET CONTEXT</span>
    <h3>Follow the evidence<span>.</span></h3>
    <div className="rar-physical-feature-cover">{cover(featured)}</div>
    <p className="rar-physical-market-copy">{guideText(featured)}</p>
    <small>Only completed, verified, comparable sales can form a guide. This is not the value of a particular collector’s copy.</small>
    <span className="rar-physical-page-number">04</span>
  </>;
}

export default function PhysicalBookDemo({ book, onClose }: { book: DemoSeriesBook; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const flipMountRef = useRef<HTMLDivElement>(null);
  const pageTemplatesRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<PageFlip | null>(null);
  const pointerStart = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const timers = useRef<number[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [coverSettled, setCoverSettled] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [spread, setSpread] = useState(0);
  const [flipError, setFlipError] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    timers.current.push(window.setTimeout(() => setIsOpen(true), 470));
    timers.current.push(window.setTimeout(() => setCoverSettled(true), 1700));
    return () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let instance: PageFlip | null = null;
    const mount = flipMountRef.current;
    const bookElement = bookRef.current;
    const templates = pageTemplatesRef.current;
    if (!mount || !bookElement || !templates) return;

    async function createBook() {
      try {
        const { PageFlip } = await import("page-flip/dist/js/page-flip.module.js");
        if (disposed || !mount || !bookElement || !templates) return;
        const host = document.createElement("div");
        host.className = "rar-physical-engine";
        mount.appendChild(host);
        const pages = Array.from(templates.querySelectorAll<HTMLElement>(".rar-flip-page"), (page) => page.cloneNode(true) as HTMLElement);
        instance = new PageFlip(host, {
          width: bookElement.offsetWidth,
          height: bookElement.offsetHeight,
          size: "stretch",
          minWidth: 100,
          maxWidth: 350,
          minHeight: 143,
          maxHeight: 501,
          usePortrait: false,
          showCover: false,
          drawShadow: true,
          maxShadowOpacity: 0.7,
          flippingTime: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 120 : 1300,
          showPageCorners: false,
          disableFlipByClick: true,
          mobileScrollSupport: true,
          useMouseEvents: false,
        });
        instance.on("flip", (event) => setSpread(event.data >= 2 ? 1 : 0));
        instance.loadFromHTML(pages);
        flipRef.current = instance;
      } catch (error) {
        console.error("Could not prepare the collector book", error);
        if (!disposed) setFlipError(true);
      }
    }

    void createBook();
    return () => {
      disposed = true;
      if (flipRef.current === instance) flipRef.current = null;
      // This library only unregisters its resize listener when its own mouse handlers are enabled.
      if (instance) window.removeEventListener("resize", instance.getUI().onResize);
      instance?.destroy();
      mount.replaceChildren();
    };
  }, [book.key]);

  function closeBook() {
    if (isClosing) return;
    setIsClosing(true);
    setIsOpen(false);
    timers.current.push(window.setTimeout(() => dialogRef.current?.close(), 720));
  }

  function pointOnBook(event: PointerEvent<HTMLDivElement>) {
    const rect = flipMountRef.current?.querySelector(".stf__block")?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null;
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!coverSettled || isClosing || !flipRef.current || pointerStart.current) return;
    const rect = bookRef.current?.getBoundingClientRect();
    const point = pointOnBook(event);
    if (!rect || !point || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const onOuterPage = spread === 0
      ? event.clientX > rect.left && event.clientX <= rect.right
      : event.clientX >= rect.left - rect.width && event.clientX < rect.left;
    if (!onOuterPage) return;
    event.preventDefault();
    pointerStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    flipRef.current.startUserTouch(point);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId || !flipRef.current) return;
    const point = pointOnBook(event);
    if (!point) return;
    start.moved ||= Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8;
    flipRef.current.userMove(point, event.pointerType === "touch");
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    const start = pointerStart.current;
    if (!start || start.id !== event.pointerId || !flipRef.current) return;
    const point = pointOnBook(event);
    pointerStart.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (point) flipRef.current.userStop(point, !start.moved);
  }

  const featured = book.owned[0];

  return <dialog
    ref={dialogRef}
    className="rar-physical-dialog"
    aria-label={`Explore ${book.name} as a book`}
    onClose={onClose}
    onKeyDown={(event) => {
      if (!coverSettled || !flipRef.current) return;
      if (event.key === "ArrowRight") { event.preventDefault(); flipRef.current.flipNext(); }
      if (event.key === "ArrowLeft") { event.preventDefault(); flipRef.current.flipPrev(); }
    }}
  >
    <div className="rar-physical-shell" data-open={isOpen} data-cover-settled={coverSettled} data-closing={isClosing} data-spread={spread}>
      <header className="rar-physical-header">
        <span>RAR / THE OPENING CHAPTER <small>ONE-BOOK INTERACTION STUDY</small></span>
        <button type="button" onClick={closeBook} autoFocus aria-label="Close the book demo">Close <span aria-hidden="true">✕</span></button>
      </header>

      <div className="rar-physical-scene">
        <div className="rar-physical-scene-title"><span>01 / 01</span><strong>{book.name}</strong><small>Drag the page corner across the spine</small></div>
        <div className="rar-physical-ground" aria-hidden="true" />
        <div className="rar-physical-grab-area" aria-label={`${book.name} book; drag a page corner to turn`}>
          <div className="rar-physical-book" ref={bookRef}>
            <div className="rar-physical-back-cover" aria-hidden="true" />
            <div className="rar-physical-page-block" aria-hidden="true" />
            <div className="rar-physical-spine" aria-hidden="true"><span>{book.name}</span><b>RAR</b></div>
            <div className="rar-physical-flip-mount" ref={flipMountRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} />
            <div className="rar-physical-front-cover" aria-hidden="true">
              <div className="rar-physical-front-face">{cover(book.representative)}<span className="rar-physical-cover-sheen" /></div>
              <div className="rar-physical-inside-face"><PageOneContent book={book} /></div>
            </div>
          </div>
        </div>
        <div className="rar-flip-templates" ref={pageTemplatesRef} hidden aria-hidden="true">
          <div className="rar-flip-page"><div className="rar-physical-inside-face rar-flip-page-content"><PageOneContent book={book} /></div></div>
          <div className="rar-flip-page"><div className="rar-physical-right-page rar-flip-page-content"><PageTwoContent book={book} /></div></div>
          <div className="rar-flip-page"><div className="rar-physical-inside-face rar-flip-page-content"><PageThreeContent featured={featured} /></div></div>
          <div className="rar-flip-page"><div className="rar-physical-right-page rar-flip-page-content"><PageFourContent featured={featured} /></div></div>
        </div>
      </div>

      <div className="rar-physical-controls">
        <p>{flipError ? "The page turn could not load; the edition links below remain available." : coverSettled ? spread === 0 ? "Drag the right page corner left to turn. Release early to let it fall back." : "Drag the left page corner right to return. Release early to let it fall back." : "Opening the book…"}</p>
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
