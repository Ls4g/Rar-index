"use client";

import Link from "next/link";
import { formatPrice } from "@/lib/fx";

export type RecentHoldingActivity = { holdingId: string; editionId: string; editionTitle: string | null; addedAt: string };
export type RecentSaleActivity = { editionId: string; editionTitle: string | null; salePrice: number; currency: string; soldDate: string | null; classification: "first_print_proven" | "known_later_print" | "printing_not_identified" };
export type LiveListingActivity = { id: string; editionId: string; editionTitle: string | null; listingTitle: string; sourceListingUrl: string; listingPrice: number | null; currency: string | null };

type ActivityFeedProps = {
  recentHoldings: RecentHoldingActivity[];
  recentSales: RecentSaleActivity[];
  liveListings: LiveListingActivity[];
  listingsLoading: boolean;
};

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(value));
}

const classificationLabel: Record<RecentSaleActivity["classification"], string> = {
  first_print_proven: "First print — proven",
  known_later_print: "Known later printing",
  printing_not_identified: "Printing not identified",
};

export default function ActivityFeed({ recentHoldings, recentSales, liveListings, listingsLoading }: ActivityFeedProps) {
  const hasActivity = recentHoldings.length > 0 || recentSales.length > 0 || liveListings.length > 0;

  return (
    <section className="portfolio-activity">
      <div className="section-intro">
        <p className="eyebrow">Collection activity</p>
        <h2>What changed</h2>
        <p className="section-copy">Only real, existing data — your recent additions, verified sale evidence for editions you own, and active listings you could buy. Never a fabricated notification.</p>
      </div>

      {hasActivity ? (
        <div className="portfolio-activity-columns">
          <div className="portfolio-activity-column">
            <h3>Recently added</h3>
            {recentHoldings.length ? (
              <ul className="portfolio-activity-list">
                {recentHoldings.map((item) => (
                  <li key={item.holdingId}>
                    <Link href={`/edition/${item.editionId}`}>{item.editionTitle ?? "Edition"}</Link>
                    <small>Added {formatShortDate(item.addedAt)}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="portfolio-activity-empty">No holdings added yet.</p>}
          </div>

          <div className="portfolio-activity-column">
            <h3>Latest verified sale evidence</h3>
            {recentSales.length ? (
              <ul className="portfolio-activity-list">
                {recentSales.map((sale, index) => (
                  <li key={`${sale.editionId}-${index}`}>
                    <Link href={`/edition/${sale.editionId}`}>{sale.editionTitle ?? "Edition"}</Link>
                    <small>{formatPrice(sale.salePrice, sale.currency)} · {sale.soldDate ? formatShortDate(sale.soldDate) : "Date not recorded"} · {classificationLabel[sale.classification]}</small>
                  </li>
                ))}
              </ul>
            ) : <p className="portfolio-activity-empty">No verified sales recorded yet for editions you own.</p>}
          </div>

          <div className="portfolio-activity-column">
            <h3>Active buying opportunities</h3>
            <p className="portfolio-activity-caveat">Asking prices from current listings, not completed sales. Never counted as market value.</p>
            {listingsLoading ? (
              <p className="portfolio-activity-empty">Checking RAR Scout…</p>
            ) : liveListings.length ? (
              <ul className="portfolio-activity-list">
                {liveListings.map((listing) => (
                  <li key={listing.id}>
                    <a href={listing.sourceListingUrl} rel="noreferrer" target="_blank">{listing.editionTitle ?? listing.listingTitle}</a>
                    <small>{listing.listingPrice !== null && listing.currency ? formatPrice(listing.listingPrice, listing.currency) : "Price not listed"} · asking price</small>
                  </li>
                ))}
              </ul>
            ) : <p className="portfolio-activity-empty">No active RAR Scout listings for your editions right now.</p>}
          </div>
        </div>
      ) : (
        <p className="portfolio-activity-empty portfolio-activity-empty-main">Nothing to show yet. Add a holding to start seeing activity here.</p>
      )}
    </section>
  );
}
