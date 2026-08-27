export type PrintClassification = "first_print_proven" | "known_later_print" | "printing_not_identified";

export const MIN_COMPARABLE_SALES = 3;

// Mirrors the database's price_observations_first_print_needs_proof check
// constraint at the application layer — a first-print claim is never valid
// without a direct proof URL tied to that exact sale. A title claim, a
// Scout lead, or the edition's own name/reputation is never enough.
export function isValidFirstPrintClaim(printingProofUrl: string | null | undefined) {
  return Boolean(printingProofUrl && printingProofUrl.trim());
}

export function splitByPrintClassification<T extends { print_classification: PrintClassification }>(sales: T[]) {
  return {
    firstPrintProven: sales.filter((sale) => sale.print_classification === "first_print_proven"),
    knownLaterPrint: sales.filter((sale) => sale.print_classification === "known_later_print"),
    printingNotIdentified: sales.filter((sale) => sale.print_classification === "printing_not_identified"),
  };
}

// Known-later-print sales only ever compare within the SAME known printing
// number — a 3rd printing and a 5th printing are never charted or valued
// together. Printing-not-identified sales are never VALUED at all and never
// enter this function; since the multi-series chart they do appear on it, but
// only as their own separate grey line, labelled as unproven and switched off
// by default whenever stronger evidence exists (see lib/priceSeries.ts).
export function groupKnownLaterPrintSales<T extends { known_printing_number: number | null }>(sales: T[]) {
  const groups = new Map<number, T[]>();
  for (const sale of sales) {
    const key = sale.known_printing_number ?? 0;
    const list = groups.get(key) ?? [];
    list.push(sale);
    groups.set(key, list);
  }
  return groups;
}

// The same minimum-comparable-sales rule PriceHistoryChart already applies
// (see components/PriceHistoryChart.tsx), reused here so a print-classification
// group is never charted or valued with fewer.
export function hasComparableChart<T extends { match_status: string }>(sales: T[], minCount = MIN_COMPARABLE_SALES) {
  return sales.filter((sale) => sale.match_status === "verified_match").length >= minCount;
}
