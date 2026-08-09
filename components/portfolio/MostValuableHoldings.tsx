"use client";

import Link from "next/link";
import EditionCover from "@/components/EditionCover";
import { formatPrice, type DisplayCurrency } from "@/lib/fx";
import type { Holding } from "@/components/portfolio/HoldingCard";
import type { HoldingMarketValue } from "@/lib/portfolioValuation";

const MAX_RANKED = 6;

type MostValuableHoldingsProps = {
  holdings: Holding[];
  values: HoldingMarketValue[];
  currency: DisplayCurrency;
  marketTotal: number;
};

// Ranking uses only holdings whose evidence value fully converted into the
// display currency (HoldingMarketValue.marketValue !== null). A holding
// with real but non-convertible evidence, or with no evidence at all, is
// simply left out of this list -- never shown ranked at the bottom as if it
// were worth nothing.
export default function MostValuableHoldings({ holdings, values, currency, marketTotal }: MostValuableHoldingsProps) {
  const holdingById = new Map(holdings.map((holding) => [holding.id, holding]));
  const ranked = values
    .filter((entry): entry is HoldingMarketValue & { marketValue: number } => entry.marketValue !== null && entry.marketValue > 0)
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, MAX_RANKED);

  return (
    <section className="portfolio-most-valuable">
      <div className="section-intro">
        <p className="eyebrow">Ranked by RAR evidence value</p>
        <h2>Most valuable holdings</h2>
      </div>
      {ranked.length ? (
        <ol className="most-valuable-list">
          {ranked.map((entry) => {
            const holding = holdingById.get(entry.holdingId);
            if (!holding) return null;
            const share = marketTotal > 0 ? (entry.marketValue / marketTotal) * 100 : null;
            return (
              <li key={entry.holdingId}>
                <Link className="most-valuable-cover" href={`/edition/${holding.edition_id}`}>
                  <EditionCover
                    title={holding.edition?.title ?? null}
                    series={holding.edition?.series}
                    volumeNumber={holding.edition?.volume_number}
                    language={holding.edition?.language}
                    imageUrl={holding.edition?.cover_image_url}
                    imageStatus={holding.edition?.cover_verification_status}
                  />
                </Link>
                <div className="most-valuable-body">
                  <Link href={`/edition/${holding.edition_id}`}><strong>{holding.edition?.title ?? "Edition"}</strong></Link>
                  <p>{[holding.edition?.series, holding.edition?.volume_number ? `Vol. ${holding.edition.volume_number}` : null, holding.edition?.language].filter(Boolean).join(" · ")}</p>
                  <div className="most-valuable-figures">
                    <span>{holding.quantity} {holding.quantity === 1 ? "copy" : "copies"}</span>
                    <strong>{formatPrice(entry.marketValue, currency)}</strong>
                    {share !== null ? <span>{share.toFixed(1)}% of portfolio</span> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="status-message">No holdings have enough verified evidence yet to rank by value.</p>
      )}
    </section>
  );
}
