# RAR Marketplace Import Contract v1

This contract answers one question: **can this marketplace record safely become a price observation for one exact edition?**

## 1. Capture a source record

Every import must preserve the marketplace record before it is matched. The business key is `source_id + external_id`; the CSV preflight skips an existing listing and never overwrites its review decision or creates a second price observation.

Required capture fields:

| Field | Rule |
| --- | --- |
| `source_id` | A known marketplace/source in RAR. |
| `external_id` | The marketplace's stable listing or sale identifier. |
| `source_listing_url` | Direct link to the original listing or result page. |
| `listing_title` | The title exactly as captured. Never rewrite it as an edition title. |
| `raw_payload` | Original machine-readable capture or a faithful structured snapshot. |
| `candidate_title` | The imported item title used for matching. |
| `candidate_language` | Language stated by the source or derived from reliable evidence. |

For a completed sale, also capture `sale_status = confirmed`, `sold_date`, `sale_price`, and `currency`. Shipping is separate from sale price. Listings marked ended, withdrawn, unavailable, or otherwise not sold use `sale_status = not_sold` and can never feed valuation.

## 2. Preflight one exact-edition batch

The staff CSV tool requires a selected, verified RAR edition before it accepts any sale records. This is a batch-level link only: every created observation still begins as `needs_review` and must be checked against the original listing.

The preflight must:

- require the v1 headers and no more than 500 rows;
- accept only `sale_status = confirmed` records with a valid URL, date, positive sale price, three-letter currency, source, external ID and JSON payload;
- block ended, withdrawn, malformed and incomplete records;
- flag duplicates within the CSV and skip any existing `source_id + external_id` record in RAR;
- report the outcome before the user can queue the safe rows.

Only the safe rows can be queued. They are never verified automatically and cannot affect a valuation until the price-review decision is `verified_match`.

## 3. Validate before matching

`import_readiness_queue` labels each `import_queue` row:

- `ready_for_edition_match` — approved record with source, external ID, title, language and raw payload.
- `needs_metadata` — approved, but missing one of those fields.
- `not_ready` — not approved or otherwise unsuitable to match.

Only `ready_for_edition_match` rows move to matching. Missing information is a queue problem, not something to guess.

## 4. Match to one exact edition

Strong match evidence is, in order:

1. ISBN for the physical edition.
2. Printing statement or number visible in the listing/photos.
3. Language, publisher/imprint, format and cover/variant.
4. Publication page, copyright page, or other identifying image.

Title similarity alone is never enough. A Gold Foil 9th printing is not interchangeable with a generic English volume; a Japanese first printing is not interchangeable with an English edition.

## 5. Make an auditable decision

Each candidate price receives exactly one current `match_status` and an evidence note:

- `verified_match` — exact edition evidence is sufficient. Only this status may feed market metrics and charts.
- `needs_review` — sale is real but edition evidence is insufficient or ambiguous. It remains visible in the staff queue only.
- `excluded` — wrong edition, a non-sale, duplicated record, or otherwise unsuitable. It never feeds market metrics.

Use `apply_price_review(observation_id, decision, notes, reviewer)` to make a decision. It records the decision in `price_review_decisions`, updates the observation, and leaves a traceable reason.

## 6. One-page operational checklist

1. Select the verified RAR edition for the batch.
2. Capture original listing data and retain the source URL/payload.
3. Confirm whether it actually sold, then run the CSV preflight.
4. Repair blocked rows; do not re-import an existing listing.
5. Queue only safe rows, then check their original listing and edition identifiers.
6. Record `verified_match`, `needs_review`, or `excluded` with a meaningful note.
7. Re-check the edition page: only verified matches may change its market value or chart.

This is intentionally conservative. A missing price is better than a misleading price.
