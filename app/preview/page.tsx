import type { Metadata } from "next";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import MarketCurrencyProvider from "@/components/MarketCurrencyProvider";
import PriceHistoryChart from "@/components/PriceHistoryChart";
import SeriesShelf from "@/components/SeriesShelf";
import { supabase } from "@/lib/supabase";
import { buildSeriesProgress, type CatalogueVolume } from "@/lib/seriesCompletion";
import type { SeriesSale } from "@/lib/priceSeries";

// A place to LOOK at components, including in the states real data cannot
// currently produce.
//
// This exists because the alternative kept happening: a component would pass
// lint, types and its own tests while looking wrong, because nothing had been
// rendered and looked at. Every design bug in this repo so far was found by
// eye -- on a phone, or in a screenshot -- never by a check.
//
// Two kinds of content, deliberately mixed:
//   - REAL catalogue rows, so covers, series lengths and gaps are the actual
//     shapes RAR has to render rather than tidy invented ones.
//   - FIXTURES, only where the catalogue cannot yet produce the state worth
//     checking (no edition has two chartable price lines, and there are no
//     graded sales at all). Fixtures are labelled on the page and never touch
//     the database.
//
// Unlisted and noindex rather than staff-gated: the point is to be able to
// open it while checking a change, and it exposes nothing a visitor could not
// already see on /browse.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Component preview — RAR Index",
  robots: { index: false, follow: false },
};

type FixtureRow = [string, number];

function fixture(rows: FixtureRow[], extra: Partial<SeriesSale> = {}): SeriesSale[] {
  return rows.map(([sold_date, sale_price]) => ({
    sold_date,
    sale_price,
    currency: "EUR",
    grading_company: null,
    grade_label: null,
    print_classification: "first_print_proven",
    known_printing_number: null,
    ...extra,
  }));
}

const gradedFixture = fixture(
  [["2025-07-09", 620], ["2025-10-20", 705], ["2026-02-15", 680], ["2026-05-01", 790]],
  { grading_company: "CGC", grade_label: "9.8" },
);

const printingsFixture: SeriesSale[] = [
  ...fixture([["2025-06-02", 120], ["2025-08-14", 134], ["2025-11-03", 128], ["2026-01-22", 152], ["2026-04-11", 147]]),
  ...fixture([["2025-06-20", 48], ["2025-09-12", 52], ["2026-01-05", 45], ["2026-04-28", 58]], { print_classification: "known_later_print", known_printing_number: 3 }),
  ...fixture([["2025-08-01", 70], ["2025-11-11", 66], ["2026-02-20", 74]], { print_classification: "printing_not_identified" }),
  // Two sales: named in the legend, never drawn.
  ...fixture([["2025-09-01", 90], ["2026-01-30", 95]], { print_classification: "known_later_print", known_printing_number: 2 }),
];

// The realistic case today: one comparison group, three sales, weeks apart.
const singleLineFixture = fixture([["2026-05-05", 96], ["2026-06-14", 84], ["2026-07-17", 89.3]]);

function Case({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <section className="preview-case">
      <div className="preview-case-head">
        <h2>{title}</h2>
        <p>{note}</p>
      </div>
      {children}
    </section>
  );
}

export default async function PreviewPage() {
  // Real rows, so the shelf is drawn from series RAR actually holds, with
  // whatever gaps and odd volume labels those really have.
  const { data } = await supabase
    .from("manga_editions")
    .select("id,title,series,volume_number,language,cover_image_url,cover_verification_status")
    .eq("is_verified", true)
    .eq("record_kind", "publication")
    .not("series", "is", null)
    // Verified covers only, so the shelf is judged on real artwork rather
    // than a row of placeholders. A real shelf mixes both; the placeholder
    // case is covered by /browse.
    .eq("cover_verification_status", "verified")
    .not("cover_image_url", "is", null)
    .limit(500);

  const catalogue: CatalogueVolume[] = ((data ?? []) as Array<{
    id: string; title: string | null; series: string | null; volume_number: string | null;
    language: string | null; cover_image_url: string | null; cover_verification_status: string | null;
  }>).map((row) => ({
    id: row.id,
    title: row.title,
    series: row.series,
    volumeNumber: row.volume_number,
    language: row.language,
    coverImageUrl: row.cover_image_url,
    coverStatus: row.cover_verification_status,
  }));

  // Ownership here is a stand-in pattern, so every shelf has holes to show.
  // Nothing is read from or written to anyone's portfolio.
  const progress = buildSeriesProgress(catalogue, catalogue.filter((_, index) => index % 3 !== 1).map((volume) => volume.id));
  const longestRuns = [...progress].sort((left, right) => right.tracked - left.tracked).slice(0, 3);
  const shortRun = progress.filter((entry) => entry.tracked === 1).slice(0, 1);

  return (
    <MarketCurrencyProvider initialCurrency="EUR">
      <main className="public-page preview-page">
        <header className="site-header">
          <Link className="brand" href="/" aria-label="RAR Index home">
            <span className="brand-mark">R</span><span>RAR</span><em>Index</em>
          </Link>
          <nav className="header-links">
            <Link className="header-note" href="/">Home</Link>
            <ThemeToggle />
          </nav>
        </header>

        <section className="preview-intro">
          <p className="eyebrow">Internal</p>
          <h1>Component preview</h1>
          <p>
            Components in the states that are easiest to get wrong: empty, one item, too many, longest label. Covers and
            series below are real catalogue rows. Anything marked <b>fixture</b> is sample data for a state the catalogue
            cannot produce yet, and never touches the database. Switch the theme in the header and check both.
          </p>
        </section>

        <div className="preview-body">
          <Case
            note="Real series and real volume gaps. Which volumes count as owned is a stand-in pattern, not anyone's collection."
            title="Shelf — long runs"
          >
            <SeriesShelf entries={longestRuns} />
          </Case>

          <Case note="One catalogued volume. The row still has to look deliberate rather than broken." title="Shelf — a single volume">
            <SeriesShelf entries={shortRun} />
          </Case>

          <Case note="Nothing on the shelf at all." title="Shelf — empty">
            <SeriesShelf entries={[]} />
          </Case>

          <Case
            note="The realistic case today: one comparison group, three sales, weeks apart."
            title="Price history — one line (fixture)"
          >
            <PriceHistoryChart rates={[]} sales={singleLineFixture} />
          </Case>

          <Case
            note="First print, a 3rd printing, unproven printings, and a two-sale group that is named but never drawn. No RAR edition has this shape yet."
            title="Price history — several printings (fixture)"
          >
            <PriceHistoryChart rates={[]} sales={printingsFixture} />
          </Case>

          <Case
            note="Graded sales share their printing's colour and are dashed. RAR has no graded sale yet, so this state is otherwise unreachable."
            title="Price history — graded only (fixture)"
          >
            <PriceHistoryChart rates={[]} sales={gradedFixture} />
          </Case>

          <Case note="Below the three-sale minimum, so no line is drawn at all." title="Price history — not enough evidence (fixture)">
            <PriceHistoryChart rates={[]} sales={singleLineFixture.slice(0, 2)} />
          </Case>
        </div>
      </main>
    </MarketCurrencyProvider>
  );
}
