# Marketplace data strategy v1

## Decision

RAR will use two separate routes, with different jobs:

1. **Official eBay Browse API** for active-listing discovery only.
2. **Staff-assisted completed-listing import** for historical sale candidates until RAR signs a written licence or partner agreement covering bulk historical sale data.

Neither route is allowed to auto-verify a sale or update a valuation.

## Why this is the current route

The [eBay Browse API](https://developer.ebay.com/develop/api/buy/browse_api) is an official listing-discovery API. Its documented search endpoints and application-token requirement make it suitable for RAR Scout's active leads, not a substitute for an auditable historical sold-price feed.

RAR must not build a scraper around completed-listings pages. That creates an unreliable and potentially non-compliant data dependency exactly where collectors most need trust.

## Current operating procedure

1. Open an exact edition's saved completed-listings profile.
2. Record a collection run: source, query, reviewer, date, and candidate count.
3. Add only confirmed sales to the RAR CSV template with the source URL and the original listing ID.
4. Preflight the batch against that exact edition.
5. Review each candidate, then verify or exclude it with notes.

For Japanese first prints, a separate printing record is only allowed when a copyright-page image proves `第1刷`.

## Before activating large-scale historical ingestion

RAR needs all of the following:

- A named provider or marketplace partner.
- Written rights covering storage, display, and analytical use of historical transaction data.
- Stable record identifiers and source URLs.
- Date, sale amount, and currency fields.
- Clear rules for cancelled, ended, relisted, and best-offer transactions.
- A test export that RAR can run through the existing preflight and review queue.

The first partner evaluation should score each option against those requirements rather than its headline record count.
