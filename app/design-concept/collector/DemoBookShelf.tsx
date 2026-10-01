"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { formatPrice } from "@/lib/fx";
import PhysicalBookDemo from "./PhysicalBookDemo";

export type DemoMarketGuide = {
  currency: string;
  median: number;
  comparisonLabel: string;
  saleCount: number;
};

export type DemoBookEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volumeNumber: string | null;
  language: string | null;
  publisher: string | null;
  coverUrl: string | null;
  coverStatus: string | null;
  marketGuide: DemoMarketGuide | null;
};

export type DemoSeriesBook = {
  key: string;
  name: string;
  language: string | null;
  representative: DemoBookEdition;
  owned: DemoBookEdition[];
  ownedVolumeCount?: number;
  cataloguedVolumes: number;
};

function cover(edition: DemoBookEdition) {
  return <EditionCover
    title={edition.title}
    series={edition.series}
    volumeNumber={edition.volumeNumber}
    language={edition.language}
    imageUrl={edition.coverUrl}
    imageStatus={edition.coverStatus}
  />;
}

function marketCopy(guide: DemoMarketGuide | null) {
  return guide
    ? `${formatPrice(guide.median, guide.currency)} · ${guide.comparisonLabel.toLowerCase()} median · ${guide.saleCount} sales`
    : "Market guide pending";
}

export default function DemoBookShelf({ books, isDemo = true, ownerName = "The Opening Chapter" }: { books: DemoSeriesBook[]; isDemo?: boolean; ownerName?: string }) {
  const [active, setActive] = useState<DemoSeriesBook | null>(null);
  const [physicalBook, setPhysicalBook] = useState<DemoSeriesBook | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!active || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [active]);

  const close = () => dialogRef.current?.close();

  return <>
    <section className="rar-demo-content" id="spotlight">
      <div className="rar-concept-container">
        <div className="rar-demo-section-heading"><div><p className="rar-concept-kicker">THE EDITORIAL SHELF</p><h2>Stories up front.</h2></div><p>Open a cover to explore {isDemo ? "the sample collector’s" : "this collector’s"} volumes, exact editions and source-backed market context.</p></div>
        <div className="rar-demo-spotlight-grid">
          {books.slice(0, 3).map((book, index) => <button className="rar-demo-spotlight-card" type="button" onClick={() => !isDemo || index === 0 ? setPhysicalBook(book) : setActive(book)} aria-haspopup="dialog" key={book.key}>
            <span className="rar-demo-spotlight-number">0{index + 1} / {!isDemo || index === 0 ? "OPEN THE BOOK" : "SAMPLE SERIES"}</span>
            <span className="rar-demo-spotlight-image">{cover(book.representative)}</span>
            <span className="rar-demo-spotlight-footer"><span className="rar-demo-book-caption"><strong>{book.name}</strong><span>Volumes: {book.ownedVolumeCount ?? book.owned.length} of {book.cataloguedVolumes} catalogued on RAR</span><span className="rar-demo-price-line">{marketCopy(book.representative.marketGuide)}</span></span><span className="rar-demo-open-icon" aria-hidden="true">{isDemo && index === 0 ? "Try 3D book ↗" : "Open book ↗"}</span></span>
          </button>)}
        </div>
      </div>
    </section>

    <section className="rar-demo-shelf" id="shelf"><div className="rar-concept-container">
      <div className="rar-demo-section-heading"><div><p className="rar-concept-kicker">THE FULL SHELF</p><h2>Every cover has a story.</h2></div><p>{books.length} {isDemo ? "sample" : "shared"} series. Volume counts show RAR catalogue coverage, not a claim about each series’ complete published run.</p></div>
      <div className="rar-demo-shelf-grid">
        {books.map((book, index) => <button className="rar-demo-shelf-item" type="button" onClick={() => !isDemo || index === 0 ? setPhysicalBook(book) : setActive(book)} aria-haspopup="dialog" key={book.key}>
          <span className="rar-demo-shelf-image">{cover(book.representative)}</span>
          <strong>{book.name}</strong>
          <span>Volumes: {book.ownedVolumeCount ?? book.owned.length} of {book.cataloguedVolumes} catalogued on RAR</span>
          <span className="rar-demo-shelf-price">{marketCopy(book.representative.marketGuide)}</span>
          <span className="rar-demo-shelf-open" aria-hidden="true">{isDemo && index === 0 ? "Try 3D book ↗" : "Open book ↗"}</span>
        </button>)}
      </div>
      <div className="rar-demo-shelf-end"><span>END OF SHELF / {String(books.length).padStart(2, "0")} SERIES</span><a href={isDemo ? "#demo-profile-title" : "#collector-title"}>Back to the top ↑</a></div>
    </div></section>

    <dialog className="rar-demo-book-dialog" ref={dialogRef} aria-label={active ? `${active.name} sample shelf` : "Sample shelf"} onClose={() => setActive(null)} onClick={(event) => { if (event.target === event.currentTarget) close(); }}>
      {active ? <div className="rar-demo-book-dialog-inner">
        <div className="rar-demo-book-toolbar"><span>RAR / OPEN SHELF · FICTIONAL DEMO</span><button type="button" onClick={close} autoFocus aria-label="Close book">Close ✕</button></div>
        <div className="rar-demo-book-stage">
          <div className="rar-demo-book-flip" aria-hidden="true">{cover(active.representative)}</div>
          <div className="rar-demo-book-page rar-demo-book-page-left">
            <span className="rar-demo-book-page-number">01 / THE SERIES</span>
            <div className="rar-demo-book-mobile-cover">{cover(active.representative)}</div>
            <p className="rar-concept-kicker">A SHELF WITHIN A SHELF</p>
            <h2>{active.name}</h2>
            <p className="rar-demo-book-language">{active.language || "Language not recorded"}</p>
            <div className="rar-demo-book-progress"><strong>{active.owned.length}</strong><span>sample volumes selected</span><strong>{active.cataloguedVolumes}</strong><span>distinct volumes catalogued on RAR</span></div>
            <p className="rar-demo-book-note">This is a fictional collection. The volume list and market evidence come from real RAR catalogue records; they do not represent a real collector’s ownership or purchase price.</p>
          </div>
          <div className="rar-demo-book-page rar-demo-book-page-right">
            <span className="rar-demo-book-page-number">02 / THE VOLUMES</span>
            <h3>On this sample shelf</h3>
            <p className="rar-demo-book-page-intro">Choose a volume to see its exact edition, verified sales and available copies.</p>
            <div className="rar-demo-volume-list">
              {active.owned.map((edition) => <Link className="rar-demo-volume-row" href={`/edition/${edition.id}`} key={edition.id}>
                <span className="rar-demo-volume-cover">{cover(edition)}</span>
                <span className="rar-demo-volume-copy"><strong>Volume {edition.volumeNumber || "—"}</strong><small>{edition.publisher || "Publisher not recorded"} · {edition.language || "Language not recorded"}</small><span>{marketCopy(edition.marketGuide)}</span></span>
                <span className="rar-demo-volume-arrow" aria-hidden="true">↗</span>
              </Link>)}
            </div>
            <p className="rar-demo-book-evidence-note">A market guide needs at least three verified sales in the same raw-printing and currency group, without value-adding extras. It is not the value of a collector’s particular copy.</p>
          </div>
        </div>
      </div> : null}
    </dialog>
    {physicalBook ? <PhysicalBookDemo book={physicalBook} onClose={() => setPhysicalBook(null)} collectorName={ownerName} isDemo={isDemo} /> : null}
  </>;
}
