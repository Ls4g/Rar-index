"use client";

import dynamic from "next/dynamic";
import GalleryInHand from "./GalleryInHand";
import type { GalleryTheme } from "@/lib/collectorGalleryTheme";

// The WebGL wall loads only when a collector has editions on display.
const GalleryPrototype = dynamic(() => import("./GalleryPrototype"), {
  ssr: false,
  loading: () => <section className="rar-gallery rar-gallery-loading" id="gallery" aria-label="Opening gallery"><div className="rar-concept-container">Opening gallery…</div></section>,
});

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
  // Set on gallery editions that belong to a run of two or more volumes of
  // the same exact edition on the wall. `slots` are the volume numbers the
  // run's bay shows in order: owned ones plus, unless the collector hides
  // them, the catalogued volumes they do not own.
  run?: DemoWallRun;
};

export type DemoWallRun = {
  key: string;
  name: string;
  editionLine: string;
  slots: string[];
  catalogued: number;
  // Volumes of this edition on the collector's shelf, on the wall or not.
  owned: number;
  // Owned volumes that are not on the wall: shown in the stack, not clickable.
  extras: Array<{ volume: string; coverUrl: string | null; title: string | null }>;
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

export default function DemoBookShelf({ books, wallEditions = [], isDemo = true, ownerName = "The Opening Chapter", galleryTitle = "", galleryCaption = "", galleryComments = {}, galleryTheme = "studio" }: { books: DemoSeriesBook[]; wallEditions?: DemoBookEdition[]; isDemo?: boolean; ownerName?: string; galleryTitle?: string; galleryCaption?: string; galleryComments?: Record<string, string>; galleryTheme?: GalleryTheme }) {
  // Real collector pages and the demo show the same gallery, and nothing else:
  // the older editorial shelf, full-shelf grid, sample-shelf pop-up and flip
  // book were earlier concepts and have been retired.
  if (wallEditions.length) return <GalleryInHand books={books} wallEditions={wallEditions} isDemo={isDemo} ownerName={ownerName} galleryTitle={galleryTitle} galleryCaption={galleryCaption || (isDemo ? "A fictional collector, shown with real RAR catalogue covers." : "")} galleryComments={galleryComments} galleryTheme={galleryTheme} />;
  if (isDemo) return <GalleryPrototype books={books} wallEditions={wallEditions} isDemo={isDemo} ownerName={ownerName} galleryTitle={galleryTitle} galleryCaption={galleryCaption} galleryComments={galleryComments} galleryTheme={galleryTheme} />;
  return <section className="rar-gallery" id="gallery"><div className="rar-concept-container"><p className="rar-concept-kicker">COLLECTOR GALLERY</p><h2>This wall is being arranged.</h2><p>Books will appear here when this collector chooses editions with confirmed covers to display.</p></div></section>;
}
