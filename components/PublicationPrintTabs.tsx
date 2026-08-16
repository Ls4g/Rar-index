"use client";

import { useState } from "react";
import Link from "next/link";
import type { FxRate } from "@/lib/fx";
import { ordinal } from "@/lib/editionDisplay";
import { groupKnownLaterPrintSales, hasComparableChart, splitByPrintClassification, MIN_COMPARABLE_SALES } from "@/lib/printClassification";
import MarketValuePanel from "@/components/MarketValuePanel";
import PriceHistoryChart from "@/components/PriceHistoryChart.tsx/PriceHistoryChart";

export type PublicationSale = {
  id: string;
  source_id: string | null;
  source_listing_url: string | null;
  listing_title: string | null;
  sold_date: string | null;
  sale_price: number;
  currency: string;
  grading_company: string | null;
  grade_label: string | null;
  match_status: "verified_match" | "needs_review";
  print_classification: "first_print_proven" | "known_later_print" | "printing_not_identified";
  printing_proof_url: string | null;
  known_printing_number: number | null;
};

type PublicationPrintTabsProps = {
  firstPrintSales: PublicationSale[];
  otherSales: PublicationSale[];
  rates: FxRate[];
  sourceNames: Record<string, string>;
  initialTab: "first" | "other";
  editionId: string;
  series: string | null;
  mode?: "publication_prints" | "exact_issue";
};

const classificationLabels: Record<PublicationSale["print_classification"], string> = {
  first_print_proven: "First print — proven",
  known_later_print: "Known later printing",
  printing_not_identified: "Printing not identified",
};

function formatPrice(value: number, code: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: code, currencyDisplay: "narrowSymbol", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(date);
}

function SaleRow({ sale, sourceNames, showPrintClassification = true }: { sale: PublicationSale; sourceNames: Record<string, string>; showPrintClassification?: boolean }) {
  return (
    <div className="observed-sale">
      <div>
        <span className="sale-source">{sale.source_id ? sourceNames[sale.source_id] ?? "Marketplace sale" : "Marketplace sale"}</span>
        <strong>{formatPrice(sale.sale_price, sale.currency)}</strong>
        <small>{formatDate(sale.sold_date)}{sale.grading_company || sale.grade_label ? ` · ${[sale.grading_company, sale.grade_label].filter(Boolean).join(" ")}` : ""}</small>
      </div>
      <div className="sale-classification">
        <span className={`sale-status ${sale.match_status}`}>{sale.match_status === "verified_match" ? "Edition match verified" : "Edition match under review"}</span>
        {showPrintClassification ? (
          <span className={`print-classification-badge is-${sale.print_classification.replaceAll("_", "-")}`}>
            {classificationLabels[sale.print_classification]}
            {sale.known_printing_number ? ` · ${ordinal(sale.known_printing_number)} printing` : ""}
          </span>
        ) : <span className="print-classification-badge is-exact-issue">Exact issue match</span>}
      </div>
      <div className="observed-sale-links">
        {sale.source_listing_url ? <a href={sale.source_listing_url} target="_blank" rel="noreferrer">View source ↗</a> : null}
        {sale.print_classification === "first_print_proven" && sale.printing_proof_url ? (
          <a href={sale.printing_proof_url} target="_blank" rel="noreferrer">View printing evidence ↗</a>
        ) : null}
      </div>
    </div>
  );
}

// Splits one classification group into "Verified — counted" / "Under
// review — not counted" the same way the page has always separated sales,
// just repeated per print group instead of once for the whole edition.
function SaleGroupList({ sales, sourceNames, showPrintClassification = true }: { sales: PublicationSale[]; sourceNames: Record<string, string>; showPrintClassification?: boolean }) {
  const verified = sales.filter((sale) => sale.match_status === "verified_match");
  const pending = sales.filter((sale) => sale.match_status === "needs_review");
  if (!sales.length) return <p className="status-message">No sales recorded in this group yet.</p>;
  return (
    <>
      {verified.length ? (
        <div className="observed-sales-group">
          <p className="observed-sales-group-label">Verified — counted in the value above ({verified.length})</p>
          <div className="observed-sales-list">{verified.map((sale) => <SaleRow sale={sale} sourceNames={sourceNames} showPrintClassification={showPrintClassification} key={sale.id} />)}</div>
        </div>
      ) : null}
      {pending.length ? (
        <div className="observed-sales-group">
          <p className="observed-sales-group-label">Under review — not yet counted ({pending.length})</p>
          <div className="observed-sales-list">{pending.map((sale) => <SaleRow sale={sale} sourceNames={sourceNames} showPrintClassification={showPrintClassification} key={sale.id} />)}</div>
        </div>
      ) : null}
    </>
  );
}

// With no completed sales at all, the tab machinery said nothing useful:
// two groups reading 0, an empty one highlighted, and three headings
// explaining how evidence RAR does not have would have been separated. A
// reader who arrives here should be told plainly that there is nothing yet,
// and offered the routes that actually exist for changing that.
function NoSalesYet({ editionId, series, exactIssue = false }: { editionId: string; series: string | null; exactIssue?: boolean }) {
  return (
    <div className="publication-no-sales">
      <strong>No completed sale verified yet</strong>
      <p>
        RAR only records a sale once it has a working link to the completed listing and can tie it to this exact
        {exactIssue ? "magazine issue" : "publication"}. Nothing has cleared that bar here, so there is no price to show — rather than an estimate.
      </p>
      <div className="publication-no-sales-actions">
        <Link className="is-primary" href={`/portfolio?edition=${editionId}`}>Add to your portfolio</Link>
        <Link href={`/request-edition?edition=${editionId}`}>Ask RAR to research this</Link>
        {series ? <Link href={`/browse?q=${encodeURIComponent(series)}`}>See the rest of {series}</Link> : <Link href="/browse">Browse the catalogue</Link>}
      </div>
      <small>Seen this sell somewhere? Send the original listing using the report form further down — it goes to a human reviewer, never straight onto the page.</small>
    </div>
  );
}

export default function PublicationPrintTabs({ firstPrintSales, otherSales, rates, sourceNames, initialTab, editionId, series, mode = "publication_prints" }: PublicationPrintTabsProps) {
  const [tab, setTab] = useState<"first" | "other">(initialTab);
  const exactIssueSales = [...firstPrintSales, ...otherSales];

  if (!exactIssueSales.length) return <NoSalesYet editionId={editionId} series={series} exactIssue={mode === "exact_issue"} />;

  if (mode === "exact_issue") {
    const verified = exactIssueSales.filter((sale) => sale.match_status === "verified_match");
    return (
      <div className="publication-print-tabs exact-issue-sales">
        <div className="print-tab-panel">
          <p className="section-copy">Only completed sales tied to this exact magazine issue count. Asking prices and similar-looking issues never affect this value, and raw and graded copies remain separate comparison groups.</p>
          <div className="print-tab-valuation">
            <p className="eyebrow">RAR market evidence · Exact issue</p>
            <MarketValuePanel sales={verified} rates={rates} />
          </div>
          <PriceHistoryChart sales={verified} rates={rates} />
          <SaleGroupList sales={exactIssueSales} sourceNames={sourceNames} showPrintClassification={false} />
        </div>
      </div>
    );
  }

  const firstVerified = firstPrintSales.filter((sale) => sale.match_status === "verified_match");
  const { knownLaterPrint: knownLater, printingNotIdentified: unidentified } = splitByPrintClassification(otherSales);

  // Known-later-print sales only ever compare against sales sharing the
  // SAME known printing number -- a 3rd printing and a 5th printing are
  // never charted or valued together, and printing-not-identified sales
  // are never charted or valued at all (see SaleGroupList below).
  const knownLaterGroups = groupKnownLaterPrintSales(knownLater);

  return (
    <div className="publication-print-tabs">
      <div className="print-tab-bar" role="tablist" aria-label="Print groups">
        <button type="button" role="tab" aria-selected={tab === "first"} className={tab === "first" ? "is-active" : ""} onClick={() => setTab("first")}>
          First-print sales <span>{firstPrintSales.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "other"} className={tab === "other" ? "is-active" : ""} onClick={() => setTab("other")}>
          Other / printing not identified <span>{otherSales.length}</span>
        </button>
      </div>

      {tab === "first" ? (
        <div className="print-tab-panel" role="tabpanel">
          <p className="section-copy">Only completed sales with proof that the specific sold copy is a first print, including an SP-confirmed inspection. A listing-title claim alone is never enough.</p>
          <div className="print-tab-valuation">
            <p className="eyebrow">RAR market evidence · First print</p>
            <MarketValuePanel sales={firstVerified} rates={rates} />
          </div>
          <PriceHistoryChart sales={firstVerified} rates={rates} />
          <SaleGroupList sales={firstPrintSales} sourceNames={sourceNames} />
        </div>
      ) : (
        <div className="print-tab-panel" role="tabpanel">
          <p className="section-copy">Completed sales for this same publication where the printing is known to be later, or cannot be proven from the source. RAR never combines these with first-print evidence, and never charts a value across different printing numbers.</p>

          {[...knownLaterGroups.entries()].map(([printingNumber, group]) => {
            const verifiedInGroup = group.filter((sale) => sale.match_status === "verified_match");
            return (
              <div className="print-tab-subgroup" key={printingNumber}>
                <h3>{printingNumber ? `${ordinal(printingNumber)} printing` : "Known later printing"} ({group.length})</h3>
                {hasComparableChart(group) ? (
                  <>
                    <div className="print-tab-valuation">
                      <MarketValuePanel sales={verifiedInGroup} rates={rates} />
                    </div>
                    <PriceHistoryChart sales={verifiedInGroup} rates={rates} />
                  </>
                ) : (
                  <p className="section-copy">Not enough comparable verified sales yet for a chart — needs {MIN_COMPARABLE_SALES} in this exact printing group, has {verifiedInGroup.length}.</p>
                )}
                <SaleGroupList sales={group} sourceNames={sourceNames} />
              </div>
            );
          })}

          <div className="print-tab-subgroup">
            <h3>Printing not identified ({unidentified.length})</h3>
            <p className="section-copy">RAR cannot confirm which printing these copies are from. They are never charted or averaged into a value.</p>
            <SaleGroupList sales={unidentified} sourceNames={sourceNames} />
          </div>
        </div>
      )}
    </div>
  );
}
