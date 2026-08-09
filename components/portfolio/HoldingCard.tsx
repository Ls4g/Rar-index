"use client";

import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { formatPrice, type DisplayCurrency } from "@/lib/fx";
import type { SummaryMetric } from "@/components/portfolio/PortfolioSummary";
import type { HoldingMarketValue } from "@/lib/portfolioValuation";

export type HoldingEdition = {
  id: string;
  title: string | null;
  series: string | null;
  volume_number: string | null;
  language: string | null;
  isbn_13: string | null;
  edition_statement: string | null;
  printing_number: number | null;
  variant_name: string | null;
  printing_of_edition_id: string | null;
  cover_image_url?: string | null;
  cover_verification_status?: string | null;
};

export type Holding = {
  id: string;
  edition_id: string;
  quantity: number;
  purchase_price: number | null;
  purchase_currency: string | null;
  purchase_date: string | null;
  notes: string | null;
  edition: HoldingEdition | null;
};

type HoldingCardProps = {
  holding: Holding;
  metrics: SummaryMetric[];
  otherSaleCount: number;
  value: HoldingMarketValue | null;
  currency: DisplayCurrency;
  onEdit: (holding: Holding) => void;
  onRemove: (id: string) => void;
};

export default function HoldingCard({ holding, metrics, otherSaleCount, value, currency, onEdit, onRemove }: HoldingCardProps) {
  const edition = holding.edition;
  const paidAmount = holding.purchase_price !== null ? holding.purchase_price * holding.quantity : null;
  // Gain comes from the shared valuation logic, which converts the purchase
  // and the market evidence into the display currency using real historical
  // rates -- the same path the portfolio totals take. A holding bought in
  // one currency against evidence in another is an ordinary case, not an
  // unanswerable one. Still never estimated: no real rate means no figure.
  const gain = value?.gain ?? null;
  const gainPercent = value?.gainPercent ?? null;
  const gainTone = gain === null ? "" : gain > 0 ? "is-positive" : gain < 0 ? "is-negative" : "";

  return (
    <article className="holding-card">
      <Link className="holding-card-cover" href={`/edition/${holding.edition_id}`}>
        <EditionCover
          title={edition?.title ?? null}
          series={edition?.series}
          volumeNumber={edition?.volume_number}
          language={edition?.language}
          imageUrl={edition?.cover_image_url}
          imageStatus={edition?.cover_verification_status}
        />
      </Link>
      <div className="holding-card-body">
        <div className="holding-card-heading">
          <p className="holding-card-quantity">{holding.quantity} {holding.quantity === 1 ? "copy" : "copies"}</p>
          <Link href={`/edition/${holding.edition_id}`}><h3>{edition?.title ?? "Edition"}</h3></Link>
          <p className="holding-card-meta">{edition ? [edition.series, edition.volume_number ? `Vol. ${edition.volume_number}` : null, edition.language].filter(Boolean).join(" · ") : "RAR edition"}</p>
        </div>

        <div className="holding-card-status">
          {metrics.length ? (
            <span className="print-classification-badge is-first-print-proven">Proven first print · {metrics.reduce((sum, metric) => sum + metric.verified_sale_count, 0)} verified sale{metrics.reduce((sum, metric) => sum + metric.verified_sale_count, 0) === 1 ? "" : "s"}</span>
          ) : otherSaleCount > 0 ? (
            <span className="print-classification-badge is-printing-not-identified">Printing not identified · {otherSaleCount} sale{otherSaleCount === 1 ? "" : "s"} on file</span>
          ) : (
            <span className="print-classification-badge is-printing-not-identified">No market evidence yet</span>
          )}
        </div>

        <dl className="holding-card-figures">
          <div>
            <dt>Paid</dt>
            {/* A missing purchase price is the one thing on this card the
                collector can fix in a click, and the thing blocking their
                chart -- so it is the action itself, not a dead label they
                have to work out how to change. */}
            <dd>
              {paidAmount !== null && holding.purchase_currency
                ? formatPrice(paidAmount, holding.purchase_currency)
                : <button className="holding-card-add-price" onClick={() => onEdit(holding)} type="button">+ Add price</button>}
            </dd>
          </div>
          <div>
            <dt>Market value</dt>
            {/* Converted into the display currency so it agrees with the
                gain beside it and the totals above. Only when a real rate
                is missing does this fall back to listing each original
                amount, rather than reporting nothing. */}
            <dd>
              {value?.marketValue != null
                ? formatPrice(value.marketValue, currency)
                : metrics.length
                  ? metrics.map((metric) => <span key={metric.currency}>{formatPrice(metric.market_value_median * holding.quantity, metric.currency)}</span>)
                  : "Not enough data"}
            </dd>
          </div>
          <div className={`holding-card-gain ${gainTone}`}>
            <dt>Gain / loss</dt>
            <dd>
              {gain !== null ? (
                // Amount and percentage are each one unbreakable string on
                // its own line -- as separate text nodes in a narrow column
                // they wrapped mid-figure, splitting the sign off the
                // number and stranding a bracket on its own row.
                <>
                  <span className="holding-card-gain-amount">{`${gain >= 0 ? "+" : ""}${formatPrice(gain, currency)}`}</span>
                  {gainPercent !== null ? <span className="holding-card-gain-percent">{`${gainPercent >= 0 ? "+" : ""}${gainPercent.toFixed(1)}%`}</span> : null}
                </>
              ) : paidAmount !== null && metrics.length ? (
                // Reached only when a real exchange rate is missing for a
                // sale or purchase date, not merely because two currencies
                // differ -- which is now converted.
                <span title="RAR has no exchange rate on file for one of these dates yet.">No rate for this date</span>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>

        {holding.notes ? <p className="holding-card-notes">{holding.notes}</p> : null}

        <div className="holding-card-actions">
          <Link className="holding-card-link" href={`/edition/${holding.edition_id}`}>View publication →</Link>
          <div className="holding-card-manage">
            <button onClick={() => onEdit(holding)} type="button">Edit</button>
            <button onClick={() => onRemove(holding.id)} type="button">Remove</button>
          </div>
        </div>
      </div>
    </article>
  );
}
