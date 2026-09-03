# RAR design decisions

What has already been decided, and why. Read this before proposing a visual
direction — most of what follows was arrived at by trying the alternative and
rejecting it, so re-proposing a rejected idea costs a round trip.

This is a decision record, not a style guide. If a decision here is wrong,
change it here first.

---

## The product, in one line

A tool for people who love manga to **track what they own and show it off**.
Pricing is the moat, not the pitch: tracking is why anyone turns up, tracking
generates the evidence, and the evidence is the part nobody else has. Any
design that leads with valuation is the wrong way round.

Audience research in the repo backs this: r/MangaCollectors mentions shelving
311 times and grading once.

---

## Typography

- **Archivo, one family, everywhere.** Display and body are the same face;
  weight and size carry hierarchy, not a second typeface. Two tokens
  (`--font-display`, `--font-sans`) still exist so old rules resolve, but they
  point at the same stack.
- Archivo is Latin-only. A system CJK stack rides behind it so Japanese
  titles, authors and publishers fall through rather than tofu.
- `--font-mono` for identifiers, ISBNs and anything fixed-width.
- Tabular figures wherever numbers line up — prices, counts, volume numbers.
  Prices should read as money, not as prose.

**Rejected:** Space Grotesk over Inter (two faces doing one job). A
whisper-weight didone display face — it made the site read old.

---

## Colour

- **Two themes, one set of rules.** `.public-page` defines Night as the
  default; `html[data-theme="day"] .public-page` overrides the same tokens.
  Never write a colour whose only definition sits inside a theme block.
- Style through tokens (`--canvas-heading`, `--muted`, `--line`,
  `--surface-card`, …), never literals, unless an element deliberately keeps
  one mood across both themes.
- `--red` is the action colour (primary buttons, active toggles).
  `--gold`/`--orange` is the accent (eyebrows, links, highlights).
  `--accent-positive-text` means owned/verified, `--accent-warning-text` means
  caution, and semantic colour is separate from the accent.
- **One chromatic accent per surface.** If something new needs a colour,
  first ask what it is competing with.

**Rejected:** warm cream (#F4F1EA) with a serif display and terracotta accent —
the generic AI-design look. Colour-block cream panels as card fills.

---

## Honesty is a design constraint, not just a data rule

The evidence rules in AGENTS.md have visual consequences. These are the ones
that keep getting rediscovered:

- **Never imply completeness RAR cannot prove.** A run reads "9 of 14
  catalogued volumes", never "complete". RAR holding every volume it knows
  about is a statement about RAR's catalogue, not about the series — One Piece
  has 100+ volumes and RAR holds a fraction.
- **Label the denominator.** Any "x of y" must say what y is.
- **Never dress catalogue data as the visitor's.** A signed-out visitor sees
  no collection figures at all. An invented shelf to fill the space is the
  same class of fabrication as an invented price.
- **A gap is not an absence of evidence.** "Missing Vol. 4" means RAR
  catalogues Vol. 4 and you do not own it. "Printing not identified" means RAR
  does not know — those are different states and must look different.
- **Separate markets are separate lines.** First print, each known printing,
  and graded copies never merge into one number or one path.

---

## Surfaces and depth

- Depth comes from a **surface ladder and hairlines**, not shadows. Cards sit
  on the canvas with a 1px `--line` border; `--card-shadow` is restrained and
  is not how a card is read.
- **Hairline-separated lists**: one border colour showing through 1px gaps, so
  a list reads as one object rather than N floating cards.
- Data surfaces (charts, tables) are flat and generously padded. The content
  is the imagery; chrome around it is not.
- Covers get **no card around them** where possible. The image is the
  component.

**Rejected:** a vignette over the cover wall — it dimmed the artwork at
exactly the edges where most of it sits, buying mood at the covers' expense.

---

## Charts

- No dashboard furniture around five data points, but a chart still needs a
  **scale**: rounded gridlines you can read a value off, and dated ticks you
  can place a point against. Two floating high/low labels are not a scale.
- **X is always a real time axis.** Index positions are a lie the moment there
  is more than one line.
- Colour encodes one thing (which printing); line style encodes another
  (raw vs graded, dashed). Do not add a colour per combination.
- A line needs 3+ sales in one comparison group. Fewer is named, not drawn.

---

## Copy

- Everyday words. No table, column or function names in anything a user reads.
- Say what a control does, then confirm it happened in the same words.
- State a limitation plainly rather than leaving a control mysteriously
  absent — "verifying a sale stays one at a time, so the exact edition can be
  checked" beats a missing button.
- No eyebrow labels purely for decoration; an eyebrow must name a real
  section.

---

## Reuse before building

These exist. Use them rather than a second version:

| Need | Component |
| --- | --- |
| Cover with fallback | `EditionCover` |
| Cover motion | `CoverWall`, `CoverConstellation` |
| Browsable shelf strip | `CollectorShelf` |
| Series shelf with gaps | `SeriesShelf` |
| Price chart | `PriceHistoryChart` |
| Small sales chart | `SaleSparkline` |
| Theme switch | `ThemeToggle` |
| Currency | `MarketCurrencyProvider`, `HomeMarketDisplay` |
| Series progress | `lib/seriesCompletion.ts` |
| Bulk selection bar | `.scout-bulk-bar` |

Auth: public accounts are Supabase Auth via `/portfolio`. Staff is a shared
credential gated by `proxy.ts`. Never add a third.

---

## Before calling a UI change done

1. Both themes. Night is the default; Day is not an afterthought.
2. **386px.** `resize_window` is broken here — use the iframe technique in
   AGENTS.md, which gets a real viewport and fires real media queries.
3. `/preview` — check the component in its awkward states (empty, one item,
   too many, longest possible label) not just the happy one.
4. Check the compiled CSS if the rule matters and cannot be seen.
5. Watch for cascade collisions. An element-qualified selector
   (`.price-chart text`) outranks a bare class (`.chart-axis-label`) and will
   silently swallow it.
