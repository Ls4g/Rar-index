# Zasshi model — how RAR identifies a magazine issue

Roadmap item 6. Written 12 August 2026, before any migration.

Japanese manga magazines carry no ISBN, and RAR's identity model assumes one
everywhere: `manga_editions.isbn_13` is the duplicate guard, the strongest
matching signal, and the field every import contract is built around. This
document decides what replaces it.

Nothing here is built yet.

## What identifies an issue

Three numbers appear on a Japanese magazine. Only one of them works.

**雑誌コード (zasshi code)** — five digits on the back cover. It identifies the
*title*, not the issue: every Weekly Shonen Jump printed between two code
revisions carries the same one (29932, later 29933). Useful as a title
attribute. Useless as an issue key.

**JAN-13 barcode** — `491` periodical flag, a spare digit, the five-digit
magazine code, two digits of month/issue, one digit of year, check digit.
This does identify the issue, but Japan only moved to the `491` prefix in
2005; before that periodicals used an `11` prefix. The valuable issues are
all pre-2005, so the barcode is absent from exactly the records that matter.

**通巻 (cumulative issue number)** — the running count since the magazine's
first issue. Weekly Shonen Jump is at roughly 2,800. The One Piece debut is
通巻1458. It never repeats, it is unaffected by the year resetting, and it
survives 合併号 (combined issues, printed as e.g. "4・5号") which break naive
per-year numbering.

**Decision: 通巻 is the key.** Year plus the printed issue label is the
fallback for records where 通巻 is unknown, and is what a human reads on the
cover.

## Where the data comes from

**Media Arts Database** (メディア芸術データベース), run by Japan's National
Center for Art Research — https://mediaarts-db.artmuseums.go.jp/

Verified against its SPARQL endpoint on 12 August 2026:

- 179,908 `MangaMagazineIssue` records across 5,753 magazine titles
- 2,388 Weekly Shonen Jump issues (`C119459`), linked by `schema:isPartOf`
- per issue: `datePublished`, `price`, `numberOfPages`, `size`, `editor`,
  `totalVolumeNumber` (通巻), `yearDisplayed`, `issueNumberDisplayed`,
  binding and zasshi code in a free-text `note`, and the holding libraries
- per issue: `hasPart` → one `Supplement` record per story, each with
  creator, `pageStart`/`pageEnd`, a genre flag (`表紙` = cover), a colour
  note, and `relatedCollectionOfManga` linking back to the work

The One Piece debut resolves correctly by content rather than title string:

| Issue | Published | 通巻 | MADB id |
|---|---|---|---|
| 1997年34号 | 1997-08-04 | 1458 | M543439 |
| 1997年35号 | 1997-08-11 | 1459 | M543438 |
| 1997年36号 | 1997-08-18 | 1460 | M543437 |

**Licence** (`/user_terms`): free to reproduce, transmit, translate and adapt;
商用利用も可能です — commercial use explicitly permitted. Attribution required,
in their prescribed form, with adaptation disclosed separately. Third-party
rights are excluded, so **cover images are not covered** — zasshi covers must
come through the existing `cover_candidates` intake like everything else.

MADB is added to `public.sources` at `trust_tier 1`, alongside Shueisha Direct
and NDL Search, following `20260728_add_japanese_catalogue_sources.sql`.

### Rejected: Comic Vine

https://comicvine.gamespot.com/weekly-shonen-jump/4050-43519/ holds 2,853 WSJ
issues with per-chapter creator credits and cover images. But its volume
metadata is name / year / publisher / aliases only — no zasshi code, no
barcode, no 通巻, no ISSN. The data model is US-comics-shaped and the page is
a fan-written essay, last substantially edited in 2021 by four contributors.

Usable later as a cover-image lead source and a cross-check. Not an identity
spine.

## Schema

### Extend `manga_editions`; do not build a parallel table

Scout leads, price review, portfolio holdings, cover review, portfolio
snapshots, availability and comparison groups all key off `edition_id`. A
separate `magazine_issues` table would require every one of those workflows to
be duplicated, which AGENTS.md prohibits ("reuse existing workflows rather
than building parallel ones for the same job").

`collectible_type` already permits `'zasshi'` — added 30 July in
`20260730_collector_research_foundations.sql`, never used. All 78 catalogue
rows are `tankobon`. The enum slot is there; the supporting columns are not.

### New table: `magazine_titles`

A magazine title is not a series and not an edition. It needs identity of its
own because the zasshi code, the run dates and the 増刊 (supplement) versus
本誌 (main magazine) distinction all live at title level.

```
id                uuid pk
name_ja           text not null        -- 週刊少年ジャンプ
name_romaji       text                 -- Weekly Shonen Jump
publisher         text not null        -- 集英社 / Shueisha
zasshi_code       text                 -- 29933
madb_id           text unique          -- C119459
parent_title_id   uuid references magazine_titles(id)   -- 増刊 → its 本誌
title_kind        text check in ('main', 'supplement', 'special_edition')
first_issued_on   date
final_issued_on   date                 -- null while running
```

`parent_title_id` is the V Jump trap made explicit. V Jump began life as
*Vジャンプ（週刊少年ジャンプ特別編集増刊）* and later separated. MADB models
these as distinct magazines and so must RAR — collapsing them recreates the
One Piece duplicate bug in a new place.

### New columns on `manga_editions`

```
magazine_title_id     uuid references magazine_titles(id)
issue_year            smallint       -- 1997
issue_number_label    text           -- '34', '4・5'  (as printed)
cumulative_issue_no   integer        -- 1458
madb_id               text           -- M543439
```

`volume_number` keeps its display role and holds `1997年34号`. Identity lives
in the structured columns.

### Uniqueness

Both partial, so no tankobon row is affected:

```sql
create unique index manga_editions_zasshi_cumulative_unique
  on public.manga_editions (magazine_title_id, cumulative_issue_no)
  where collectible_type = 'zasshi'
    and printing_of_edition_id is null
    and cumulative_issue_no is not null;

create unique index manga_editions_zasshi_issue_label_unique
  on public.manga_editions (magazine_title_id, issue_year, issue_number_label)
  where collectible_type = 'zasshi'
    and printing_of_edition_id is null;
```

### The duplicate guard has a hole

`apply_catalogue_review` currently blocks duplicates by ISBN only
(`20260804_catalogue_review_printing_guard.sql`, lines 80–92). A zasshi record
has no ISBN, so **that check never fires and magazines would ship with zero
duplicate protection** — the precise condition that produced the One Piece and
Hunter × Hunter duplicates for books.

The function must be extended in place (create or replace, same signature — no
new overload; the stale overload dropped on 14 August is why) so that
approving a `zasshi` candidate:

- requires `magazine_title_id`, and either `cumulative_issue_no` or
  `issue_year` + `issue_number_label`
- fails with a clear error when that identity already exists, unless the
  reviewer names the existing edition it is a printing of — mirroring the
  ISBN branch exactly

### New table: `magazine_issue_contents`

This is what makes an issue collectible. A 1997 Jump is worth £5; the one with
chapter 1 of One Piece is worth a great deal more, and the only difference is
what is printed inside.

```
id                uuid pk
edition_id        uuid not null references manga_editions(id) on delete cascade
work_title        text not null       -- ONE PIECE
creator           text
chapter_number    text
page_start        numeric
page_end          numeric
appearance_kind   text check in
  ('serial_chapter','first_chapter','final_chapter','one_shot','cover','colour_page')
madb_part_id      text                -- S1040248
source_url        text not null
created_at        timestamptz
```

`appearance_kind = 'first_chapter'` is the field that explains value.

**These are catalogue facts, not price evidence.** Contents describe why an
issue is significant. They never set, adjust or imply a price, and they are
never admissible as sale evidence. The evidence rules are unchanged: a
verified sale is still a completed sale with a working original source link
attached to one exact record.

## Human-in-the-loop

MADB import lands in `catalogue_import_queue` and a human approves it, exactly
like every other source. No row reaches `manga_editions` without a review
decision written to `catalogue_review_decisions`.

The importer may pre-fill and it may flag conflicts. It may not verify.

## What gets harder

Nothing about existing Scout behaviour changes. Search profiles are scoped per
edition, so zasshi adds new searches rather than altering book ones, and a
scan of all 2,385 leads in the queue on 12 August found **zero** genuine
Japanese magazine listings — Scout is not mismatching them today because
nothing asks it to look. The cost is confined to the new category.

**Within that category, auto-matching starts weak.** `assessEditionMatch`
weights ISBN at 20 and volume at 20. For a zasshi, ISBN is always null and
`volume_number` is `1997年34号`, which no eBay listing types. A real listing —
*"Shonen Jump 1997 One Piece 1st appearance"* — scores series 30 + language 15
+ publisher 15 and lands at "insufficient", sending every lead to human
review. Correct under the rules, but a triage backlog rather than coverage.

The fix is a zasshi-aware normaliser: extract year and issue number from
listing text, fold `4・5` / `4-5` / `4&5` to one form, and treat a 通巻 or
year+issue match as the ISBN-strength signal. That lifts a good listing back
into the 65–80 band books occupy now.

**Two naming traps, both measured in the live queue and both certain to break
a naive implementation:**

*"Shonen Jump" is a VIZ imprint, not the magazine.* 99 of the 2,385 leads
contain the phrase and every one is an English paperback — *"Hunter x Hunter
Vol 1 Paperback ... Shonen Jump Viz Media"*. A search profile keyed on the
magazine's name would return 99 books and no magazines. The name is close to
worthless as a signal; year plus issue number is the signal.

*"Issue" does not mean issue.* Ten leads read *"Vol 1 Issue 1"*, all of them
sellers restating the volume number of a tankobon. Matching on the word sends
books into the magazine queue.

**Covers.** MADB supplies none. Until the cover intake catches up, zasshi
edition pages render without the blurred-artwork banner that
`.edition-stage-art` provides, since that design only ever uses verified
covers.

## Order of work

1. Migration — `magazine_titles`, the five columns, both partial unique
   indexes, the extended review guard, MADB in `sources`.
2. MADB import script → `catalogue_import_queue`. Weekly Shonen Jump only.
   Validate against real issues before it touches the queue.
3. `magazine_issue_contents` and the edition-page display.
4. Zasshi-aware Scout matching.

Steps 1 and 2 are the schema decision. Steps 3 and 4 are separate pieces of
work and should not be bundled into the same change.
