"use client";

import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { formatPrice } from "@/lib/fx";
import type { SummaryMetric } from "@/components/portfolio/PortfolioSummary";

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
  onEdit: (holding: Holding) => void;
  onRemove: (id: string) => void;
};

export default function HoldingCard({ holding, metrics, otherSaleCount, onEdit, onRemove }: HoldingCardProps) {
  const edition = holding.edition;
  const paidAmount = holding.purchase_price !== null ? holding.purchase_price * holding.quantity : null;
  // A per-card gain/loss is only ever shown when the purchase and the
  // market evidence already share one currency — no conversion happens at
  // this level. A mismatch is explained, never estimated.
  const matchingMetric = paidAmount !== null && holding.purchase_currency ? metrics.find((metric) => metric.currency === holding.purchase_currency) ?? null : null;
  const gain = matchingMetric && paidAmount !== null ? matchingMetric.market_value_median * holding.quantity - paidAmount : null;
  const gainPercent = gain !== null && paidAmount ? (gain / paidAmount) * 100 : null;
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
            <dd>{paidAmount !== null && holding.purchase_currency ? formatPrice(paidAmount, holding.purchase_currency) : "Not recorded"}</dd>
          </div>
          <div>
            <dt>RAR evidence</dt>
            <dd>
              {metrics.length
                ? metrics.map((metric) => <span key={metric.currency}>{formatPrice(metric.market_value_median * holding.quantity, metric.currency)}</span>)
                : "Not enough data"}
            </dd>
          </div>
          <div className={`holding-card-gain ${gainTone}`}>
            <dt>Gain / loss</dt>
            <dd>
              {gain !== null ? (
                <>{gain >= 0 ? "+" : ""}{formatPrice(gain, holding.purchase_currency as string)}{gainPercent !== null ? ` (${gainPercent >= 0 ? "+" : ""}${gainPercent.toFixed(1)}%)` : ""}</>
              ) : paidAmount !== null && metrics.length ? (
                "Different currency"
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
