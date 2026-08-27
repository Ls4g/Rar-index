import { comparisonGroup, type MarketSale } from "./fx.ts";
import { MIN_COMPARABLE_SALES, type PrintClassification } from "./printClassification.ts";
import { ordinal } from "./editionDisplay.ts";

// One chart, several lines — the split rules, kept out of the component.
//
// RAR has always separated evidence correctly and then shown it in separate
// places: raw and graded were separate charts side by side, and first-print
// and later-print sales were behind different tabs. Nothing was ever wrong,
// but comparing a first print against a later printing meant switching tabs
// and holding two y-axes in your head.
//
// So the separation moves from "different charts" to "different lines on one
// chart". That is not a relaxation of the rule: two lines on shared axes are
// still two comparison groups, never pooled, never averaged together, and
// never joined by a single path. What changes is only that you can see them
// at the same time.
//
// The dimensions that split a series, and why each one has to:
//   - printing:  a first print and a 5th printing are different objects with
//                different markets. Known later printings split further by
//                printing NUMBER, because printClassification.ts is explicit
//                that a 3rd and a 5th printing are never charted together.
//   - grading:   a graded copy is a different market from a raw one. RAR has
//                no graded sales yet, so this dimension currently yields
//                nothing — it is built now so that the first graded sale
//                becomes its own line without a rewrite.

export type SeriesSale = MarketSale & {
  print_classification: PrintClassification;
  known_printing_number: number | null;
};

export type PriceSeriesKind = "first_print" | "later_printing" | "printing_unknown";

export type PriceSeries<T extends SeriesSale = SeriesSale> = {
  id: string;
  label: string;
  kind: PriceSeriesKind;
  printingNumber: number | null;
  grading: string;
  graded: boolean;
  sales: T[];
  /** A line is only drawn from MIN_COMPARABLE_SALES or more. Fewer than that
   *  is a couple of data points, and joining them would draw a trend RAR
   *  cannot support — the same bar the single-group chart always applied. */
  chartable: boolean;
};

function printingPart(sale: SeriesSale): { kind: PriceSeriesKind; printingNumber: number | null; key: string; label: string } {
  if (sale.print_classification === "first_print_proven") {
    return { kind: "first_print", printingNumber: null, key: "first", label: "First print" };
  }
  if (sale.print_classification === "known_later_print") {
    const number = sale.known_printing_number ?? null;
    return {
      kind: "later_printing",
      printingNumber: number,
      // Printing number is part of the key, so two different printings can
      // never land in the same series.
      key: `later:${number ?? "unnumbered"}`,
      label: number ? `${ordinal(number)} printing` : "Later printing",
    };
  }
  return { kind: "printing_unknown", printingNumber: null, key: "unknown", label: "Printing not identified" };
}

const KIND_ORDER: Record<PriceSeriesKind, number> = { first_print: 0, later_printing: 1, printing_unknown: 2 };

/**
 * Splits sales into the lines a chart may draw. Input should already be
 * restricted to verified, confirmed sales for one publication — this decides
 * how they separate, never whether they count.
 */
export function buildPriceSeries<T extends SeriesSale>(sales: T[], minSales = MIN_COMPARABLE_SALES): PriceSeries<T>[] {
  const groups = new Map<string, PriceSeries<T>>();

  for (const sale of sales) {
    if (!sale.sold_date) continue;
    const printing = printingPart(sale);
    const grading = comparisonGroup(sale);
    const id = `${printing.key}::${grading.key}`;
    const existing = groups.get(id);
    if (existing) {
      existing.sales.push(sale);
      continue;
    }
    groups.set(id, {
      id,
      // The grading half is only appended when there is something to say, so
      // a catalogue with no graded sales reads "First print", not
      // "First print · Raw" on every line.
      label: grading.key === "Raw" ? printing.label : `${printing.label} · ${grading.grading}`,
      kind: printing.kind,
      printingNumber: printing.printingNumber,
      grading: grading.grading,
      graded: grading.key !== "Raw",
      sales: [sale],
      chartable: false,
    });
  }

  return [...groups.values()]
    .map((series) => ({
      ...series,
      sales: [...series.sales].sort((left, right) => String(left.sold_date).localeCompare(String(right.sold_date))),
      chartable: series.sales.length >= minSales,
    }))
    .sort((left, right) => {
      if (KIND_ORDER[left.kind] !== KIND_ORDER[right.kind]) return KIND_ORDER[left.kind] - KIND_ORDER[right.kind];
      if (left.printingNumber !== right.printingNumber) return (left.printingNumber ?? 0) - (right.printingNumber ?? 0);
      // Raw before graded within the same printing.
      if (left.graded !== right.graded) return Number(left.graded) - Number(right.graded);
      return left.label.localeCompare(right.label);
    });
}

/**
 * Which lines start switched on.
 *
 * Everything chartable is on, except printing-not-identified — those sales
 * are real and worth being able to see, but they are the weakest evidence on
 * the page and should not be what a visitor looks at first. The exception is
 * when they are the ONLY thing there is: hiding the sole line by default
 * would present an empty chart and imply RAR has nothing.
 */
export function defaultVisibleSeries<T extends SeriesSale>(series: PriceSeries<T>[]): string[] {
  const chartable = series.filter((entry) => entry.chartable);
  const named = chartable.filter((entry) => entry.kind !== "printing_unknown");
  return (named.length ? named : chartable).map((entry) => entry.id);
}

// Two channels rather than one palette, because a series differs along two
// independent axes and colour alone would need a slot for every combination:
//
//   colour = which printing        (see --series-N in globals.css)
//   dashes = raw or graded         (graded is dashed, matching the hollow
//                                   graded marker SaleSparkline already uses)
//
// So "First print" and "First print · Graded CGC 9.8" are the same hue in
// solid and dashed, which reads as two views of the same book -- true, and
// far easier to hold than two unrelated colours.
//
// Colour is assigned by meaning, not by position in the list, so a first
// print is always slot 0 and an unproven printing is always the grey slot 5,
// whatever else the edition happens to have.
export const SERIES_COLOUR_COUNT = 6;
const UNKNOWN_PRINTING_COLOUR = 5;
const LATER_PRINTING_COLOURS = [1, 2, 3, 4];

export function seriesColourIndex(series: PriceSeries[], id: string) {
  const entry = series.find((candidate) => candidate.id === id);
  if (!entry) return 0;
  if (entry.kind === "first_print") return 0;
  if (entry.kind === "printing_unknown") return UNKNOWN_PRINTING_COLOUR;
  // Later printings take the remaining slots in printing-number order, so the
  // 2nd printing keeps its colour even when a 5th printing appears later.
  const printings = [...new Set(
    series.filter((candidate) => candidate.kind === "later_printing").map((candidate) => candidate.printingNumber ?? 0),
  )].sort((left, right) => left - right);
  const position = printings.indexOf(entry.printingNumber ?? 0);
  return LATER_PRINTING_COLOURS[(position < 0 ? 0 : position) % LATER_PRINTING_COLOURS.length];
}
