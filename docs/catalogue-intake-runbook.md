# RAR catalogue intake runbook

## The question it answers

**Can RAR identify this exact collectible before any sale is attached to it?**

This is the operating checklist for every manga record. It is deliberately
slower than a bulk import because it keeps the catalogue trustworthy when the
same title has many languages, formats and printings.

## 1. Start with an exact source record

Use the strongest available source in this order:

1. The original publisher's own product or catalogue record.
2. A publisher's official archive or catalogue.
3. A national-library record as an independent cross-check.
4. Open Library for discovery only.
5. MangaDex for series discovery only; it cannot establish a physical edition.

Record the original URL, its external identifier and the source payload before
reviewing it. A marketplace listing is never a catalogue source.

## 2. Capture a candidate, never an edition directly

Every import goes to `catalogue_import_queue` with:

- source and source URL;
- title, series, volume, author, publisher, language and release date;
- ISBN-13 (when present), format and country;
- source cover URL (when supplied); and
- the unchanged source payload.

The importer must not write straight to `manga_editions`.

## 3. Review the physical identity

The reviewer checks each of these before approving:

| Check | Required decision |
| --- | --- |
| Title / series / volume | Matches one distinct published volume |
| Language and publisher | Match the source record exactly |
| ISBN | Matches the physical format, not a digital ISBN |
| Date | Kept as the source's edition release date |
| Printing | Left blank unless direct printing evidence exists |
| Cover | Only marked verified when an official/licensed, exact-edition source is stored |

"First print", "first edition", a print run, an obi, condition, or a
signed/graded status must never be inferred from a generic catalogue record.

## 4. Make a named, auditable decision

In **Catalogue review**, a named staff reviewer chooses one outcome and writes
an evidence note of at least 12 characters:

- `approve_new` — creates one RAR edition;
- `link_existing` — adds source evidence to an already exact match;
- `keep_in_review` — the record needs more evidence;
- `duplicate` — the source repeats an existing candidate; or
- `reject` — it is not a physical-edition match.

Only `approve_new` publishes a new RAR edition. A verified cover also needs an
exact source URL, source name and verification date; unverified candidate
covers stay hidden behind the RAR fallback.

## 5. Attach market evidence afterwards

Sales are separate observations. Add them only after the edition exists, keep
the original sale URL, and review whether it is a completed sale for that exact
edition. A sale is never evidence for a printing unless its listing or supplied
inspection evidence proves that printing.

Every sale also gets its own `print_classification` — `first_print_proven`,
`known_later_print`, or `printing_not_identified` (the safe default). This is
a property of the specific sold copy, not the catalogue edition: an edition
named "1997 first printing (verified)" does not make any individual sale
attached to it a proven first print on its own. `first_print_proven` always
requires a direct printing-proof URL for that exact sale, and is only ever
set through `apply_price_print_classification` — from Add Sale, the Review
queue, or a CSV batch's `print_classification` column — never inferred
automatically.

## Definition of done

An edition is ready for discovery when its identity is published, its source
trail can be inspected, and any displayed cover is verified. It is ready for a
value or chart only when it has independently reviewed comparable completed
sales.
