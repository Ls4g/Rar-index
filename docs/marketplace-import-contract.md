# RAR Marketplace Import Contract v1

This contract answers one question: **can this marketplace record safely become a price observation for one exact edition?**

## 1. Capture a source record

Every import must preserve the marketplace record before it is matched. The business key is `source_id + external_id`; importing the same listing twice must update the existing record, never create a second price observation.

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

## 2. Validate before matching

`import_readiness_queue` labels each `import_queue` row:

- `ready_for_edition_match` — approved record with source, external ID, title, language and raw payload.
- `needs_metadata` — approved, but missing one of those fields.
- `not_ready` — not approved or otherwise unsuitable to match.

Only `ready_for_edition_match` rows move to matching. Missing information is a queue problem, not something to guess.

## 3. Match to one exact edition

Strong match evidence is, in order:

1. ISBN for the physical edition.
2. Printing statement or number visible in the listing/photos.
3. Language, publisher/imprint, format and cover/variant.
4. Publication page, copyright page, or other identifying image.

Title similarity alone is never enough. A Gold Foil 9th printing is not interchangeable with a generic English volume; a Japanese first printing is not interchangeable with an English edition.

## 4. Make an auditable decision

Each candidate price receives exactly one current `match_status` and an evidence note:

- `verified_match` — exact edition evidence is sufficient. Only this status may feed market metrics and charts.
- `needs_review` — sale is real but edition evidence is insufficient or ambiguous. It remains visible in the staff queue only.
- `excluded` — wrong edition, a non-sale, duplicated record, or otherwise unsuitable. It never feeds market metrics.

Use `apply_price_review(observation_id, decision, notes, reviewer)` to make a decision. It records the decision in `price_review_decisions`, updates the observation, and leaves a traceable reason.

## 5. One-page operational checklist

1. Capture original listing data and retain the source URL/payload.
2. Confirm whether it actually sold.
3. Check import readiness; repair missing fields before matching.
4. Link to an exact edition only when the evidence supports it.
5. Record `verified_match`, `needs_review`, or `excluded` with a meaningful note.
6. Re-check the edition page: only verified matches may change its market value or chart.

This is intentionally conservative. A missing price is better than a misleading price.
