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
2. Publisher-direct records (for example Shueisha Direct) are the strongest catalogue source for that publisher's standard edition. They still do not prove a particular printing.
3. National Diet Library Search is an independent bibliographic cross-check. Its records are candidates, not proof of a specific printing.
4. Open Library records are **candidates**, not proof. A reviewer verifies physical-edition fields before approval.
5. MangaDex records are `series_reference` candidates. They can support research but cannot create a physical edition.
6. Every decision requires a named reviewer and an evidence note of at least 12 characters.
7. Only `approve_new` creates a verified edition. `link_existing` attaches source evidence to a known exact RAR edition.
8. Rejected, duplicate and unresolved candidates retain their audit trail rather than disappearing.

## Repeatable operating loop

1. Start with the publisher-direct source where it exists, then use NDL Search as an independent check. Use Open Library and MangaDex only as supporting discovery sources.
2. Inspect original source evidence in **Catalogue review**.
3. Approve, link, keep in review, mark duplicate, or reject with a note.
4. Add marketplace-sale candidates only after the exact edition exists.
5. Verify sales before they influence valuation or a trend chart.
