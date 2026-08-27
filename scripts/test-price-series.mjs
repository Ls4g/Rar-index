// Chart series splitting. Run with:
//   node --experimental-strip-types scripts/test-price-series.mjs
//
// Putting several comparison groups on one chart is only safe if the split
// rules are exactly as strict as they were when each group had its own chart.
// Every case here is a way two markets could have been silently pooled into
// one line.
import { buildPriceSeries, defaultVisibleSeries, seriesColourIndex } from "../lib/priceSeries.ts";

let failures = 0;
function check(name, condition, extra = "") {
  if (!condition) { failures += 1; console.log(`  FAIL  ${name}${extra ? `\n        ${extra}` : ""}`); }
  else console.log(`  PASS  ${name}`);
}

const sale = (overrides = {}) => ({
  sold_date: "2026-01-01", sale_price: 100, currency: "USD",
  grading_company: null, grade_label: null,
  print_classification: "first_print_proven", known_printing_number: null,
  ...overrides,
});

const first = (date, price) => sale({ sold_date: date, sale_price: price });
const later = (date, price, printing) => sale({ sold_date: date, sale_price: price, print_classification: "known_later_print", known_printing_number: printing });
const unknown = (date, price) => sale({ sold_date: date, sale_price: price, print_classification: "printing_not_identified" });
const graded = (date, price) => sale({ sold_date: date, sale_price: price, grading_company: "CGC", grade_label: "9.8" });

console.log("\n--- printings never pool ---");
{
  const series = buildPriceSeries([
    first("2026-01-01", 100), first("2026-02-01", 110), first("2026-03-01", 120),
    later("2026-01-05", 40, 3), later("2026-02-05", 45, 3), later("2026-03-05", 50, 3),
    later("2026-01-06", 20, 5), later("2026-02-06", 22, 5), later("2026-03-06", 24, 5),
  ]);
  check("a first print is its own series", series.some((s) => s.kind === "first_print" && s.sales.length === 3));
  // The rule printClassification.ts states outright: a 3rd printing and a
  // 5th printing are never charted together.
  const third = series.find((s) => s.printingNumber === 3);
  const fifth = series.find((s) => s.printingNumber === 5);
  check("a 3rd and a 5th printing are separate series", Boolean(third && fifth) && third.id !== fifth.id);
  check("neither printing absorbed the other's sales", third.sales.length === 3 && fifth.sales.length === 3);
  check("printings are labelled by ordinal", third.label === "3rd printing" && fifth.label === "5th printing", `${third.label} / ${fifth.label}`);
  check("three printings make exactly three series", series.length === 3, JSON.stringify(series.map((s) => s.label)));
}

console.log("\n--- raw and graded never pool ---");
{
  const series = buildPriceSeries([
    first("2026-01-01", 100), first("2026-02-01", 110), first("2026-03-01", 120),
    graded("2026-01-02", 800), graded("2026-02-02", 850), graded("2026-03-02", 900),
  ]);
  check("graded first prints split from raw first prints", series.length === 2, JSON.stringify(series.map((s) => s.label)));
  const gradedSeries = series.find((s) => s.graded);
  check("the graded series is flagged graded", Boolean(gradedSeries) && gradedSeries.sales.length === 3);
  check("the graded series names its grade", gradedSeries.label.includes("CGC") && gradedSeries.label.includes("9.8"), gradedSeries.label);
  // An £800 graded sale must never drag a raw first-print line upwards.
  const raw = series.find((s) => !s.graded);
  check("no graded price leaked into the raw series", raw.sales.every((s) => s.sale_price < 200));
  check("raw is listed before graded", series[0].graded === false);
}

console.log("\n--- unproven printings stay apart and stay quiet ---");
{
  const series = buildPriceSeries([
    first("2026-01-01", 100), first("2026-02-01", 110), first("2026-03-01", 120),
    unknown("2026-01-03", 60), unknown("2026-02-03", 65), unknown("2026-03-03", 70),
  ]);
  check("printing-not-identified is its own series", series.some((s) => s.kind === "printing_unknown"));
  check("it never merges into the first-print series", series.find((s) => s.kind === "first_print").sales.length === 3);
  // It is real evidence and stays available, but it is the weakest thing on
  // the page and must not be what a visitor is shown first.
  const visible = defaultVisibleSeries(series);
  check("it is off by default when something stronger exists", !visible.includes(series.find((s) => s.kind === "printing_unknown").id));
  check("the first print is on by default", visible.includes(series.find((s) => s.kind === "first_print").id));
}
{
  // ...unless it is all RAR has, in which case hiding it would present an
  // empty chart and imply there is no evidence at all.
  const series = buildPriceSeries([unknown("2026-01-03", 60), unknown("2026-02-03", 65), unknown("2026-03-03", 70)]);
  check("it is on by default when it is the only series", defaultVisibleSeries(series).length === 1);
}

console.log("\n--- the three-sale minimum still governs a line ---");
{
  const series = buildPriceSeries([
    first("2026-01-01", 100), first("2026-02-01", 110),
    later("2026-01-05", 40, 2), later("2026-02-05", 45, 2), later("2026-03-05", 50, 2),
  ]);
  const firstSeries = series.find((s) => s.kind === "first_print");
  check("two sales is not enough for a line", firstSeries.chartable === false);
  check("three sales is enough for a line", series.find((s) => s.printingNumber === 2).chartable === true);
  check("an unchartable series is still reported, not dropped", series.length === 2);
  check("an unchartable series is not visible by default", !defaultVisibleSeries(series.filter((s) => s.chartable)).includes(firstSeries.id));
}

console.log("\n--- undated sales cannot be plotted ---");
{
  const series = buildPriceSeries([
    first("2026-01-01", 100), first("2026-02-01", 110), first("2026-03-01", 120),
    sale({ sold_date: null, sale_price: 999 }),
  ]);
  // A sale with no date has no position on a time axis, and guessing one
  // would invent evidence.
  check("a sale with no date is excluded", series.reduce((total, s) => total + s.sales.length, 0) === 3);
  check("no invented price entered the series", series.every((s) => s.sales.every((row) => row.sale_price !== 999)));
}

console.log("\n--- ordering and colour carry meaning ---");
{
  const series = buildPriceSeries([
    unknown("2026-01-03", 60), unknown("2026-02-03", 65), unknown("2026-03-03", 70),
    later("2026-01-05", 40, 2), later("2026-02-05", 45, 2), later("2026-03-05", 50, 2),
    first("2026-01-01", 100), first("2026-02-01", 110), first("2026-03-01", 120),
  ]);
  check("first print sorts first regardless of input order", series[0].kind === "first_print");
  check("printing-not-identified sorts last", series.at(-1).kind === "printing_unknown");
  // Colour is assigned by meaning, so these two never drift onto another
  // slot as an edition gains printings.
  check("first print always takes the gold slot", seriesColourIndex(series, series[0].id) === 0);
  check("unproven printing always takes the grey slot", seriesColourIndex(series, series.at(-1).id) === 5);
  const laterSeries = series.find((s) => s.kind === "later_printing");
  check("a later printing takes neither", ![0, 5].includes(seriesColourIndex(series, laterSeries.id)));
}
{
  // A graded copy of a printing shares that printing's hue -- they are the
  // same book, separated by the dash pattern instead.
  const series = buildPriceSeries([
    first("2026-01-01", 100), first("2026-02-01", 110), first("2026-03-01", 120),
    graded("2026-01-02", 800), graded("2026-02-02", 850), graded("2026-03-02", 900),
  ]);
  const raw = series.find((s) => !s.graded);
  const gradedSeries = series.find((s) => s.graded);
  check("graded shares the hue of its printing", seriesColourIndex(series, raw.id) === seriesColourIndex(series, gradedSeries.id));
  check("they are still separate series", raw.id !== gradedSeries.id);
}

console.log("\n--- real RAR shapes ---");
{
  // The live catalogue's busiest edition today: proven first prints, one
  // unnumbered later printing, and a block of unproven ones.
  const series = buildPriceSeries([
    first("2025-11-01", 120), first("2025-12-10", 132), first("2026-01-17", 128), first("2026-02-02", 140),
    unknown("2025-10-04", 70), unknown("2025-12-01", 82), unknown("2026-01-09", 76),
    later("2026-01-20", 55, null),
  ]);
  check("three groups are recognised", series.length === 3, JSON.stringify(series.map((s) => `${s.label}:${s.sales.length}`)));
  check("the unnumbered later printing is labelled honestly", series.some((s) => s.label === "Later printing"));
  check("one lone later-print sale is not chartable", series.find((s) => s.kind === "later_printing").chartable === false);
  check("only the first print is on by default", defaultVisibleSeries(series.filter((s) => s.chartable)).length === 1);
}

console.log(`\n${failures === 0 ? "all checks passed" : `${failures} failed`}\n`);
process.exit(failures === 0 ? 0 : 1);
