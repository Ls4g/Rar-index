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
| `evidence_image_url` | Optional direct URL for a clear copyright/colophon or printing-page image from the specific listing. Its presence does not verify the sale automatically. |
| `candidate_title` | The imported item title used for matching. |
| `candidate_language` | Language stated by the source or derived from reliable evidence. |

For a completed sale, also capture `sale_status = confirmed`, `sold_date`, `sale_price`, and `currency`. Shipping is separate from sale price. Listings marked ended, withdrawn, unavailable, or otherwise not sold use `sale_status = not_sold` and can never feed valuation.

Two further optional columns let a batch classify the printing of the specific sold copy, not the catalogue edition:

| Field | Rule |
| --- | --- |
| `print_classification` | Optional. One of `printing_not_identified` (default when blank), `known_later_print`, or `first_print_proven`. `first_print_proven` is rejected by the preflight unless `evidence_image_url` is also present on that row — the same rule the database itself enforces. |
| `known_printing_number` | Optional positive whole number, e.g. `1` for a first printing or `3` for a known third printing. |

A row that sets `print_classification` is committed through `apply_price_print_classification` immediately after import, with an auditable note and the reviewer name supplied for the whole batch — never a raw column write. Leaving the column blank is always safe; the sale simply stays `printing_not_identified` until a human reviews it, same as everything else.

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
4. A copyright/colophon or other identifying image from the specific listing or physical copy. Save its direct image URL in `evidence_image_url`.

Title similarity alone is never enough. A Gold Foil 9th printing is not interchangeable with a generic English volume; a Japanese first printing is not interchangeable with an English edition.

## 5. Make an auditable decision

Each candidate price receives exactly one current `match_status` and an evidence note:

- `verified_match` — exact edition evidence is sufficient. Only this status may feed market metrics and charts.
- `needs_review` — sale is real but edition evidence is insufficient or ambiguous. It remains visible in the staff queue only.
- `excluded` — wrong edition, a non-sale, duplicated record, or otherwise unsuitable. It never feeds market metrics.

Use `apply_price_review(observation_id, decision, notes, reviewer)` to make a decision. It records the decision in `price_review_decisions`, updates the observation, and leaves a traceable reason.

This is an edition-match decision only — it says nothing about which printing the copy is. That is a separate, equally auditable decision.

## 5a. Classify the printing, separately

Every sale also carries `print_classification`, defaulting to `printing_not_identified` and never set by any automated step:

- `first_print_proven` — direct proof (typically a copyright-page image) ties this exact sold copy to a first printing. Requires `printing_proof_url`.
- `known_later_print` — the printing is known, but it is not the first. `known_printing_number` records which one when known.
- `printing_not_identified` — the safe default. A title claim, a Scout lead, or the edition's own reputation is never enough to leave this state.

Use `apply_price_print_classification(observation_id, classification, printing_proof_url, known_printing_number, notes, reviewer)` to change it — from the Review queue, Add Sale, or a CSV batch's `print_classification` column. It records the decision in `price_print_classification_decisions` and can be re-run later to correct an earlier classification; nothing overwrites that history.

## 6. One-page operational checklist

1. Select the verified RAR edition for the batch.
2. Capture original listing data and retain the source URL/payload.
3. Confirm whether it actually sold, then run the CSV preflight.
4. Repair blocked rows; do not re-import an existing listing.
5. Queue only safe rows, then check their original listing, copyright-page reference and edition identifiers.
6. Record `verified_match`, `needs_review`, or `excluded` with a meaningful note.
7. Re-check the edition page: only verified matches may change its market value or chart.

This is intentionally conservative. A missing price is better than a misleading price.
