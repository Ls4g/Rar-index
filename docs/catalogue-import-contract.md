# RAR catalogue-import contract

## Question this process answers

**Can RAR identify this exact edition confidently enough to attach market data later?**

## Capture format

Every catalogue candidate must preserve:

- `source_id` and original `source_record_url`
- source `external_id` and unmodified `raw_payload`
- candidate title, series, volume, author, publisher, language, ISBN-13, release date, format and cover when supplied
- candidate type: `edition_candidate` or `series_reference`
- import timestamp and queue status

## Safety rules

1. Imports enter `catalogue_import_queue`; no importer writes directly to `manga_editions`.
2. Open Library records are **candidates**, not proof. A reviewer verifies physical-edition fields before approval.
3. MangaDex records are `series_reference` candidates. They can support research but cannot create a physical edition.
4. Every decision requires a named reviewer and an evidence note of at least 12 characters.
5. Only `approve_new` creates a verified edition. `link_existing` attaches source evidence to a known exact RAR edition.
6. Rejected, duplicate and unresolved candidates retain their audit trail rather than disappearing.

## Repeatable operating loop

1. Search one source for a title in **Catalogue import**.
2. Inspect original source evidence in **Catalogue review**.
3. Approve, link, keep in review, mark duplicate, or reject with a note.
4. Add marketplace-sale candidates only after the exact edition exists.
5. Verify sales before they influence valuation or a trend chart.
