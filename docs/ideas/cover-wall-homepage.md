# Cover wall homepage — parked

Parked 26 August 2026, after two rounds of prototyping. Live at
`/design-prototypes` (unlinked). Pick it back up or delete the page.

## Where it landed

**Option B, the scrolling wall, is the one.** Six columns of verified covers
at three different speeds, alternating direction, looping seamlessly, tap a
cover to hold it out of the flow. Option A (the drifting constellation) was
rejected.

## What the two rounds taught

**Round one was static and both options failed.** The reference — Cosmos on
refero.design — is a motion piece, and reproducing it as a still image
produced floating polaroids that do not float, which is just a grid at an
angle. That was a choice, not a limitation.

**Round two added motion and B worked immediately.** Movement was the whole
problem, not the layout.

**Round three fixed the variety.** The wall was showing Dragon Ball over and
over. Partly a real property of the catalogue and partly a bug: covers were
read in catalogue order, so the first screenful was whatever series happened
to be adjacent in the table. They are now interleaved by series — one volume
from each title in turn, then the next from each — so the first twelve tiles
are twelve different series.

## The open problem, and why it is parked

RAR holds 83 verified covers across only 14 series: 18 One Piece, 11 Dragon
Ball, 11 Bleach, 10 Berserk, 9 Naruto. Interleaving fixes the top of the
wall, but the small series exhaust after two or three rounds and the tail
falls back to the big five. 19 of 75 vertical neighbours still share a series.

That is not a layout bug. A wall whose argument is "look how much RAR holds"
is only as convincing as the catalogue behind it, and the honest state today
is five series and a long tail. The treatment gets better on its own as
coverage widens, which is the argument for parking rather than polishing.

## What taking it off the pin looks like

- Move `CoverWall` into `app/page.tsx`, delete `app/design-prototypes/` and
  `CoverConstellation`, and remove the prototype CSS block from `globals.css`.
- Reconsider the series spread first. Roughly 25 series with two or three
  covers each would carry the wall far better than 14 series with eighteen
  One Piece.

## Where it could go, other than the homepage

Approved 26 Aug as "can definitely use it somewhere". The homepage is the
obvious slot and probably not the best one.

- **A collector's public shelf, `/collectors/{handle}`.** The strongest fit.
  The variety problem disappears entirely, because the covers are whatever
  that person owns rather than whatever RAR has catalogued, and it turns the
  page into somebody's collection instead of a promotional wall. It also
  gives the shelf a reason to be looked at by someone who is not its owner.
- **`/browse`.** The wall as the interface rather than as decoration — tap a
  cover to open the edition, so the motion is doing a job.
- **`/collection`.** The display-led front door, where an abundant wall
  matches what that audience came for.

The homepage remains possible, but it is the one placement where the
catalogue's narrowness shows most, because it is the one seen by people who
have no collection of their own to fill it.

## Taken from Cosmos, and deliberately not

Taken: colour comes only from the artwork, and nothing casts a shadow —
depth is scale, rotation and opacity instead.

Not taken: the typeface. Cosmos's signature is a didone serif at weight 350,
which is precisely the direction rejected in August for making the site read
old. See [[rar-design-direction]].
