# REWORK 2026-07-30h — Kolonner, den tredje visningen

User mandate, 2026-07-30. Adds a third week view; supersedes nothing. In
particular it does **not** reverse REWORK-2026-07-29b D1: the transposed week
stays, and stays the default.

## The finding

D1's arithmetic was right and is unchanged — a day *row* is the full page width,
a day *column* is a fifth of it — but it answered a question about geometry with
a change of shape, and shape is not only geometry. A timetable with days across
the top and time down the side is the form every student already owns: school,
NTNU's own timeplan, every calendar app they have used. Familiarity is worth
something the width calculation cannot price, and the honest resolution of
"which is better" is that both are, for different people and different weeks.

So the switch grows a third position and the student chooses. It is still one
plan: same `PlanCourseState[]`, same `collectSessions` narrowing, same conflict
engine, same popover, same margin notes — `renderGrid` still owns the verdict
and the notes in every view, drawing into a discard host when it is not the one
on screen.

## D1 — The width law: the day grows, the code never shrinks

The problem the transposition escaped is real and comes straight back when days
are columns: two overlapping lectures split a column, and at five equal columns
each half is narrower than the seven characters that identify the course. Piles
were what that produced last time.

The rule here is the opposite of squeezing:

```
dagbredde = maks(likedel, dypeste klynge × banebredde)
```

and it is **one line of CSS**, not a measuring pass:

```css
grid-template-columns: var(--planner-rail) repeat(5, minmax(var(--planner-daymin), 1fr));
```

`1fr` is the fair share; the `minmax` minimum is what the week's deepest cluster
needs. A grid track never shrinks below that minimum, so when five days want
more than the viewport has, the grid overflows and `.planner-grid-frame` scrolls
it sideways. The day gets wider; the code is never cut. `columnGrid.ts`
therefore contains no resize listener and no `getBoundingClientRect` — the
browser already computes the fair-share half, at every width, before paint.

`--planner-lane-min` is 4.25rem: a seven-character code in Spline Sans Mono at
`--text-xs` (~49 px) plus the block's padding and air. It is the one measurement
in this view that is not a taste, and it does **not** shrink on a phone — a
phone is exactly where shaving it starts cutting codes.

## D2 — What the column view keeps, and why

- **Lanes are per cluster, not per day.** A block in a 2-deep overlap takes half
  its column; a lone 16:00 øving in the same day still takes all of it.
- **A drop-in window is a strip, not a lane** (`isDropIn`, exported from
  `grid.ts` so both grids make one call): an 08:15–14:00 øvingsvindu drawn as a
  block is a slab with a lecture buried in it. Every column reserves the strip
  width, so lane widths stay comparable across the week.
- **One collision zone per incident**, across the lanes, drawn *over* the blocks
  — two colliding lectures fill the column between them, so a zone behind them
  would be invisible.
- **The rail is sticky.** A timetable scrolled sideways off its own clock is two
  facts short of being a timetable. The frame's left mask ramp is dropped for
  this view (`:has(.planner-cols)`), because it existed to fade a rail that
  scrolls away and would otherwise fade the one that does not.

## D3 — Naming

The tabs are **Rader · Kolonner · Liste**. The two grids are named by how the
days are arranged, not by what they are made of: "Rutenett" and "Kolonner" would
both be grids and neither word would say which one you were about to get. That
retires "Rutenett" as a tab label (it stays the name of the paper, in DESIGN).

## What this touched

`columnGrid.ts` (new), `board.ts` (`collectSessions`/`SessionEntry` exported —
one collection pipeline behind two views), `grid.ts` (`isDropIn` exported),
`plannerApp.ts` (three-way switch, `syncGridScroll` measures whichever week is
mounted, `scrollToToday` repointed at `.planner-cols-day-header` — it had been
querying a class the transposed week stopped rendering in D1 and had done
nothing since), `planner-week.css`, `planlegger/index.astro`.

## D4 — The drop-in strip stands up, and there can be more than one

The first cut drew the window as 8 px of colour with no text, no hover, no
click. That is not a subordinate label, it is an anonymous one: five slivers
down the week naming nothing and answering nothing. Two fixes, one rule —
**a session you can attend is a session you can ask about, whether it takes a
lane or a strip**:

- The strip is a `<button>` on the same footing as a block: same hue treatment
  (`--block-muted`, the øving layer's own ink), same `title`, same `aria-label`,
  same `blockDetailFor` popover.
- Its type turns 90° with it (`writing-mode: vertical-rl`) and reads down the
  strip: code, then what it is. A window is five hours by definition, so the
  axis this label runs along is the one it can never be short of. The strip
  widened to `1.6rem` to carry one line of `--text-xs` on its side.
- It sits against the column's OPENING border, under the weekday name. On the
  far edge it sat against the next day's border and read as that day's.

Multiple windows on one day now stack in both grids. The column view indexes
them from the column's edge; the transposed week did not stack at all —
`--planner-bands` was written as a boolean while the row-height arithmetic
that consumed it had always been written for a count, so a Monday with two open
windows drew them at the same offset, one exactly over the other, and the week
was silently a course short. TDT4102's two ten-hour lab groups are the case
that shows it.

## D5 — The layer change, turned with the axis

`beginLayerChange` gained its third branch (`beginColumnChange`), so "vis
øvinger og labber" reads the same in all three views: what stays travels, what
arrives strikes in after the room for it exists, what leaves wipes out first
and the space closes behind it. Everything is the existing machinery — the
snapshot/rewind/release wrapper is shared; only the property names and the
direction differ:

- geometry is `--planner-y`/`--planner-h` (percentages of the drawn span) and
  `--planner-lane`/`--planner-lanes`, against the transposed week's `-x`/`-w`;
- `COL_GRID_PROPS` rewinds all three of the column BOX's inputs —
  `--planner-hours` (its height), `--planner-lanes-max` and
  `--planner-bands-max` (its minimum width). Revealing a layer usually changes
  all three at once, and a property missing here is a dimension that snaps
  while everything around it travels — the same failure `--planner-bands`
  already caused once in the transposed week;
- `.planner-cols-lanes` transitions its own inset, because that inset IS the
  width the drop-in strips reserve: without it a day gaining its first window
  shoves every lecture in the week sideways on one frame;
- sessions strike in and wipe out DOWNWARD (`planner-strike-down`), along this
  view's own axis rather than across it.

A session's identity across the re-render is `board.ts`'s `motionKey`, exported
and now shared: the transposed week keys on `GridEntry.ordinal`, which this
pipeline never assigns. Measured in Chromium: the column height interpolates
504 → 678 → 719 → 720 px and the lane box travels 1001 → 1045 → 1056 px over
one `--dur`, rather than either landing on frame one.

## D6 — The drop-in strip joins the order, in both views

The strip was outside every sequence it should have been inside, which is why
the timing read as wrong on a view switch *and* on the layer toggle:

- **It carried no `--planner-strike`.** That is not "no stagger", it is step
  zero: every strip in the week fired on the first frame and the sessions then
  trickled in behind them, so the quietest thing on the page arrived first and
  all at once. Both renderers now take a number from the same counter, strips
  first within their day — an open window is the field the day's appointments
  are printed on.
- **The column view's strip was not in the `is-striking` rule at all**, so on a
  view switch it simply appeared, fully formed, beside things that were
  printing.
- **The strike-in had no ceiling.** Once strips joined the count a two-window
  week ran twenty deep, and 20 × 55 ms is a second of trickle. Capping the
  index was the wrong fix and lasted one round: everything past the ceiling
  shares one delay, and because the sequence runs day by day, that tail is a
  whole weekday landing on a single frame ("why does Thursday and Friday come
  in at the same time"). The cap is replaced by `staggerStep(count, base)` —
  the sequence keeps its own rhythm until it would outlast
  `STAGGER_BUDGET_MS` (620), then the INTERVAL compresses. Every element keeps
  its own moment, which is the whole point of a stagger, and the total is
  bounded, which is what the cap was actually for. Each renderer publishes its
  computed interval as `--planner-step` and the arrival/departure paths publish
  `--planner-motion-step`; the stylesheet multiplies indices by those instead
  of by a hard-coded 55/45/32 ms. Measured on a 15-session week: 0 →
  620 ms in 44.3 ms steps, no two elements sharing a delay.
- **Arrivals were being spent on room, not sessions.** In the column view every
  new hour figure took a stagger step, so revealing a layer that stretched the
  axis pushed the actual arrivals four steps later for nothing. Only blocks and
  strips take numbers now; the rest is room being made.
- `keyColumns` walks blocks and strips in ONE document-order pass. Two queries
  meant every session in the week arrived before the first strip — two waves
  with no relation to the week's own reading order.
