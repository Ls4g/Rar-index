# RAR alpha-readiness audit — 2 August 2026

## Purpose

Check that an alpha tester can discover editions, inspect evidence, maintain a RAR-only portfolio, and send a missing-edition lead without gaining access to staff workflows.

## Checks completed

| Area | Result | Notes |
| --- | --- | --- |
| Public home, browse and portfolio routes | Pass | Pages loaded without an application error. |
| Edition record | Pass | Japanese *One Piece 1* first-print record renders with source links, sales and confidence information. The previous `One Piece I` title was corrected in the database. |
| Missing-edition feedback | Pass | `/request-edition` presents the public, source-backed request form and clearly says submissions do not publish automatically. |
| Staff boundary | Pass | Direct unauthenticated access to `/catalogue-requests` and `/price-import` shows staff sign-in rather than the queue or importer. |
| Mobile layout | Pass | At a 390 px viewport, home, browse, portfolio, request-edition and edition pages had no horizontal overflow or application error. |
| Production smoke test | Pass | The deployed public routes above were checked directly. |

## Known alpha limits

- Catalogue identity is stronger than market coverage. Some priority editions do not yet have enough clean, verified sales to support a valuation or chart.
- Three requested priority records intentionally remain without a verified cover until a reliable source is found: Japanese *Attack on Titan* Vol. 1, English *Initial D* Vol. 1 and Japanese *Initial D* Vol. 1.
- A local production build could not complete in this sandbox because Next.js could not reach Google Fonts. This is an external network limitation here, not a production failure; live production route checks passed.
- Staff workflow submission itself was not faked during this audit. Real import/review testing uses genuine sourced sales only.

## Alpha gate

RAR is ready for a small, clearly labelled alpha focused on discovery, evidence review and portfolio tracking. It is not ready to promise comprehensive price coverage or automated collection scans.
